// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {TradeCore} from "./common/TradeCore.sol";
import {TokenOps} from "./common/TokenOps.sol";
import {ClassicTypes as Types} from "./classic/ClassicTypes.sol";
import {ProtocolQuoteHelper} from "./ProtocolQuoteHelper.sol";
import {
    IV2Router, IUniV3Router, IPancakeV3Router, IAerodromeRouter, ISlipstreamRouter
} from "./classic/ClassicInterfaces.sol";

/// @notice Owner-funded exact-input swaps with a single executable round per settings epoch.
contract BaseSwapExecutor is TradeCore {
    error InvalidDexPolicy();
    error InvalidFees();

    event DexPolicyUpdated(uint8 dex, uint32[] tickSpacings);
    event V3FeesUpdated(uint24[] fees);

    address public immutable v2Factory;
    address public immutable v2Router;
    address public immutable v3Factory;
    address public immutable v3Router;
    address public immutable quoterV2;
    ProtocolQuoteHelper public immutable aerodromeQuoteHelper;

    uint8 public dex;
    uint24[] public v3Fees;
    uint32[] private _spacings;
    Types.Settings private _settings;
    address[11] private _aero;
    address[5] private _pancake;

    constructor(address initialOwner, address[6] memory config, address[11] memory aero, address[5] memory pancake)
        TradeCore(initialOwner, config[0])
    {
        _validateLane(config[1], config[2]);
        _validateLane(config[3], config[4], config[5]);
        _validateLane(aero[0], aero[1]);
        for (uint256 i = 2; i < aero.length; i += 3) {
            _validateLane(aero[i], aero[i + 1], aero[i + 2]);
        }
        _validateLane(pancake[0], pancake[1]);
        _validateLane(pancake[2], pancake[3], pancake[4]);

        v2Factory = config[1];
        v2Router = config[2];
        v3Factory = config[3];
        v3Router = config[4];
        quoterV2 = config[5];
        _aero = aero;
        _pancake = pancake;
        aerodromeQuoteHelper = new ProtocolQuoteHelper(config, aero, pancake);
        v3Fees = [uint24(100), 500, 3000, 10000];
    }

    function getAerodromeConfig() external view returns (address[11] memory) {
        return _aero;
    }

    function getPancakeConfig() external view returns (address[5] memory) {
        return _pancake;
    }

    function getDexPolicy() external view returns (uint8 venue, uint32[] memory spacings) {
        return (dex, _spacings);
    }

    function getSettings() external view returns (Types.Settings memory) {
        return _settings;
    }

    function getV3Fees() external view returns (uint24[] memory) {
        return v3Fees;
    }

    function setSettings(Types.Settings calldata next) external onlyOwner nonReentrant {
        _save(next, v3Fees, maxSellLossBps, dex, _spacings);
    }

    function setSettingsAndFees(Types.Settings calldata next, uint24[] calldata fees) external onlyOwner nonReentrant {
        _save(next, fees, maxSellLossBps, dex, _spacings);
    }

    function setSettingsAndFeesAndTax(Types.Settings calldata next, uint24[] calldata fees, uint16 sellLossBps)
        external
        onlyOwner
        nonReentrant
    {
        _save(next, fees, sellLossBps, dex, _spacings);
    }

    function setSettingsAndDex(
        Types.Settings calldata next,
        uint24[] calldata fees,
        uint16 sellLossBps,
        uint8 venue,
        uint32[] calldata spacings
    ) external onlyOwner nonReentrant {
        _save(next, fees, sellLossBps, venue, spacings);
    }

    function setV3Fees(uint24[] calldata fees) external onlyOwner nonReentrant {
        if (_settings.tokenIn == address(0)) {
            _validateFees(dex, fees);
            v3Fees = fees;
            _afterSettings(maxSellLossBps);
            emit V3FeesUpdated(fees);
        } else {
            _save(_settings, fees, maxSellLossBps, dex, _spacings);
        }
    }

    function quoteBest(uint256 amountIn) external nonReentrant returns (Types.Route memory best, Types.Route[] memory candidates) {
        if (_settings.tokenIn == address(0)) revert NotConfigured();
        return aerodromeQuoteHelper.quote(_settings, amountIn, dex, v3Fees, _spacings);
    }

    function simulateTax(Types.Settings calldata next, uint24[] calldata fees, uint256 amountIn)
        external
        onlyOwner
        nonReentrant
    {
        _simulate(next, fees, amountIn, Types.UNI, new uint32[](0));
    }

    function simulateTaxWithDex(
        Types.Settings calldata next,
        uint24[] calldata fees,
        uint256 amountIn,
        uint8 venue,
        uint32[] calldata spacings
    ) external onlyOwner nonReentrant {
        _simulate(next, fees, amountIn, venue, spacings);
    }

    // Retain the superseded entry point for the original artifact's interface.
    function runTaxSimulation(Types.Settings calldata, uint24[] calldata, uint256)
        external
        pure
        returns (TaxExecutionResult memory)
    {
        revert TaxSimulationOnlySelf();
    }

    function runTaxSimulationWithDex(
        Types.Settings calldata next,
        uint24[] calldata fees,
        uint256 amountIn,
        uint8 venue,
        uint32[] calldata spacings
    ) external returns (TaxExecutionResult memory result) {
        if (msg.sender != address(this)) revert TaxSimulationOnlySelf();
        Types.Settings memory probe = next;
        probe.testSell = true;
        probe.checkBurn = false;
        _validateSettings(probe, fees, venue, spacings);
        if (amountIn == 0 || TokenOps.balanceOf(probe.tokenIn, address(this)) < amountIn) revert InsufficientInput();
        (Types.Route memory route,) = aerodromeQuoteHelper.quote(probe, amountIn, venue, fees, spacings);
        return _trade(probe, route, amountIn, 1, block.timestamp);
    }

    function _settingsInput() internal view override returns (address) {
        return _settings.tokenIn;
    }

    function _settingsMinimum() internal view override returns (uint256) {
        return _settings.minBuyAmount;
    }

    function _executeTrade(uint256 amountIn, uint256 requestedMinimum, uint256 deadline)
        internal
        override
        returns (uint256 bought, uint256 received, uint256 testInputRecovered)
    {
        Types.Settings memory current = _settings;
        (Types.Route memory best,) = aerodromeQuoteHelper.quote(current, amountIn, dex, v3Fees, _spacings);
        uint256 minimum = _executionMinimum(requestedMinimum);
        TaxExecutionResult memory result = _trade(current, best, amountIn, minimum, deadline);
        emit Bought(best.kind, best.pool, best.fee, amountIn, best.amountOut, result.bought, result.received, result.recovered);
        return (result.bought, result.received, result.recovered);
    }

    function _simulate(
        Types.Settings calldata next,
        uint24[] calldata fees,
        uint256 amountIn,
        uint8 venue,
        uint32[] memory spacings
    ) private {
        try this.runTaxSimulationWithDex(next, fees, amountIn, venue, spacings) returns (TaxExecutionResult memory result) {
            // This revert is emitted only after the self-call returns measured results.
            // Callee reverts are wrapped so an arbitrary token cannot spoof the top-level report.
            _report(result);
        } catch (bytes memory reason) {
            revert TaxSimulationFailed(reason);
        }
    }

    function _save(
        Types.Settings memory next,
        uint24[] memory fees,
        uint16 sellLossBps,
        uint8 venue,
        uint32[] memory spacings
    ) private {
        _validateSettings(next, fees, venue, spacings);
        _settings = next;
        v3Fees = fees;
        dex = venue;
        _spacings = spacings;
        _afterSettings(sellLossBps);
        emit SettingsUpdated(next.tokenIn, next.tokenOut, next.recipient);
        emit V3FeesUpdated(fees);
        emit DexPolicyUpdated(venue, spacings);
    }

    function _validateSettings(
        Types.Settings memory next,
        uint24[] memory fees,
        uint8 venue,
        uint32[] memory spacings
    ) private view {
        _checkRecipient(next.recipient);
        if (next.tokenIn.code.length == 0 || next.tokenOut.code.length == 0 || next.tokenIn == next.tokenOut) {
            revert InvalidSettings();
        }
        if (next.maxBurnBps > BPS || next.testSellBps > BPS || ((next.checkBurn || next.testSell) && next.testSellBps == 0)) {
            revert InvalidSettings();
        }
        _validateFees(venue, fees);
        aerodromeQuoteHelper.validateSpacings(venue, spacings);

        bool classic;
        bool concentrated;
        if (venue == Types.UNI) {
            classic = v2Router != address(0);
            concentrated = v3Router != address(0) && fees.length != 0;
        } else if (venue == Types.AERO) {
            classic = _aero[1] != address(0);
            concentrated = spacings.length != 0;
        } else if (venue == Types.PANCAKE) {
            classic = _pancake[1] != address(0);
            concentrated = _pancake[3] != address(0) && fees.length != 0;
        }
        if ((!next.allowV2 || !classic) && !concentrated) revert InvalidDexPolicy();
    }

    function _validateFees(uint8 venue, uint24[] memory fees) private view {
        if (venue > Types.PANCAKE) revert InvalidDexPolicy();
        try aerodromeQuoteHelper.validateFees(venue, fees) {} catch {
            revert InvalidFees();
        }
    }

    function _trade(
        Types.Settings memory s,
        Types.Route memory route,
        uint256 amountIn,
        uint256 minimum,
        uint256 deadline
    ) private returns (TaxExecutionResult memory r) {
        if (route.pool == address(0) || route.amountOut == 0) revert NoEligiblePool();
        r.kind = route.kind;
        r.pool = route.pool;
        r.fee = route.fee;
        r.amountIn = amountIn;
        r.expectedBuy = route.amountOut;
        r.bought = _swap(route, s.tokenIn, s.tokenOut, amountIn, deadline, false);
        if (r.bought < minimum) revert MinimumNotMet(r.bought, minimum);
        if (s.checkBurn && r.bought < _requiredAfterLoss(r.expectedBuy, s.maxBurnBps)) {
            revert BurnLimitExceeded(r.expectedBuy, r.bought);
        }

        uint16 probeBps = (s.checkBurn || s.testSell) ? s.testSellBps : 0;
        if (probeBps != 0) {
            r.probeAmount = _lossFloor(r.bought, BPS - probeBps);
            if (r.probeAmount == 0) revert SellProbeFailed();
            r.expectedSell = aerodromeQuoteHelper.reverseQuote(route, s.tokenIn, s.tokenOut, r.probeAmount);
            if (r.expectedSell == 0) revert SellProbeFailed();
            r.recovered = _swap(route, s.tokenOut, s.tokenIn, r.probeAmount, deadline, true);
            if (r.recovered == 0) revert SellProbeFailed();
            if (s.checkBurn && r.recovered < _requiredAfterLoss(r.expectedSell, maxSellLossBps)) {
                revert SellLossLimitExceeded(r.expectedSell, r.recovered);
            }
        }

        r.forwarded = r.bought - r.probeAmount;
        // Compare against the portion preserved by the configured probe percentage.
        // The actual probe transfer is rounded down to a whole token unit.
        r.expectedRecipient = _lossFloor(r.expectedBuy, probeBps);
        if (r.forwarded != 0) {
            r.received = _forward(s.tokenOut, s.recipient, r.forwarded);
            uint256 recipientMinimum = _lossFloor(minimum, probeBps);
            if (recipientMinimum == 0) recipientMinimum = 1;
            if (r.received < recipientMinimum) revert MinimumNotMet(r.received, recipientMinimum);
        }
        if (s.checkBurn && r.received < _requiredAfterLoss(r.expectedRecipient, s.maxBurnBps)) {
            revert BurnLimitExceeded(r.expectedRecipient, r.received);
        }
    }

    function _swap(
        Types.Route memory route,
        address input,
        address output,
        uint256 amount,
        uint256 deadline,
        bool probe
    ) private returns (uint256 outputAmount) {
        (address router, bytes memory data) = _routerCall(route, input, output, amount, deadline);
        if (router.code.length == 0) revert InvalidDexPolicy();

        uint256 inputBefore = TokenOps.balanceOf(input, address(this));
        if (amount > inputBefore) revert InsufficientInput();
        uint256 outputBefore = TokenOps.balanceOf(output, address(this));
        TokenOps.forceApprove(input, router, amount);
        (bool ok, bytes memory reason) = router.call(data);
        if (!ok) {
            if (probe) revert SellProbeFailed();
            assembly ("memory-safe") {
                revert(add(reason, 32), mload(reason))
            }
        }
        TokenOps.forceApprove(input, router, 0);
        uint256 outputAfter = TokenOps.balanceOf(output, address(this));
        if (TokenOps.balanceOf(input, address(this)) != inputBefore - amount || outputAfter < outputBefore) {
            revert UnexpectedBalance();
        }
        outputAmount = outputAfter - outputBefore;
    }

    function _forward(address token, address recipient, uint256 amount) private returns (uint256) {
        uint256 oldHeld = TokenOps.balanceOf(token, address(this));
        uint256 oldRecipient = TokenOps.balanceOf(token, recipient);
        TokenOps.transfer(token, recipient, amount);
        uint256 newRecipient = TokenOps.balanceOf(token, recipient);
        if (oldHeld < amount || TokenOps.balanceOf(token, address(this)) != oldHeld - amount || newRecipient < oldRecipient) {
            revert UnexpectedBalance();
        }
        return newRecipient - oldRecipient;
    }

    function _routerCall(
        Types.Route memory route,
        address input,
        address output,
        uint256 amount,
        uint256 deadline
    ) private view returns (address router, bytes memory data) {
        uint8 kind = route.kind;
        // Output floors are enforced on measured balance changes, within the same atomic swap.
        if (kind == Types.UNI_V2 || kind == Types.PANCAKE_V2) {
            router = kind == Types.UNI_V2 ? v2Router : _pancake[1];
            data = abi.encodeCall(
                IV2Router.swapExactTokensForTokensSupportingFeeOnTransferTokens,
                (amount, 0, Types.v2Path(input, output), address(this), deadline)
            );
        } else if (kind == Types.UNI_V3) {
            router = v3Router;
            data = abi.encodeCall(
                IUniV3Router.exactInputSingle,
                (IUniV3Router.Swap(input, output, route.fee, address(this), amount, 0, 0))
            );
        } else if (kind == Types.PANCAKE_V3) {
            router = _pancake[3];
            data = abi.encodeCall(
                IPancakeV3Router.exactInputSingle,
                (IPancakeV3Router.Swap(input, output, route.fee, address(this), deadline, amount, 0, 0))
            );
        } else if (kind == Types.AERO_VOLATILE || kind == Types.AERO_STABLE) {
            router = _aero[1];
            IAerodromeRouter.Hop[] memory hops = new IAerodromeRouter.Hop[](1);
            hops[0] = IAerodromeRouter.Hop(input, output, kind == Types.AERO_STABLE, _aero[0]);
            data = abi.encodeCall(
                IAerodromeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens,
                (amount, 0, hops, address(this), deadline)
            );
        } else if (kind >= Types.SLIPSTREAM_G1 && kind <= Types.SLIPSTREAM_G3) {
            router = _aero[3 + 3 * (kind - Types.SLIPSTREAM_G1)];
            data = abi.encodeCall(
                ISlipstreamRouter.exactInputSingle,
                (ISlipstreamRouter.Swap(input, output, int24(route.fee), address(this), deadline, amount, 0, 0))
            );
        } else {
            revert InvalidDexPolicy();
        }
    }

    function _validateLane(address factory, address router) private view {
        if (factory == address(0) && router == address(0)) return;
        if (factory.code.length == 0 || router.code.length == 0) revert InvalidConfiguration();
    }

    function _validateLane(address factory, address router, address quoter) private view {
        if (factory == address(0) && router == address(0) && quoter == address(0)) return;
        if (factory.code.length == 0 || router.code.length == 0 || quoter.code.length == 0) {
            revert InvalidConfiguration();
        }
    }
}

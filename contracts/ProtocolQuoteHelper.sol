// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {ClassicTypes as Types} from "./classic/ClassicTypes.sol";
import {
    IV2Factory, IV2Router, IFeePoolFactory, IFeeQuoter, IAerodromeFactory,
    IAerodromePool, ISlipstreamFactory, ISlipstreamQuoter, IClassicBalance
} from "./classic/ClassicInterfaces.sol";

/// @notice Prices direct pools on the protocols selected at deployment.
contract ProtocolQuoteHelper {
    error InvalidDexPolicy();

    uint256 private constant READ_GAS = 80_000;
    uint256 private constant QUOTE_GAS = 600_000;

    address[6] private _uniswap;
    address[11] private _aerodrome;
    address[5] private _pancake;

    constructor(address[6] memory uni, address[11] memory aero, address[5] memory pancake) {
        _uniswap = uni;
        _aerodrome = aero;
        _pancake = pancake;
    }

    function getConfig() external view returns (address[11] memory) {
        return _aerodrome;
    }

    function getNetworkConfig() external view returns (address[6] memory, address[11] memory, address[5] memory) {
        return (_uniswap, _aerodrome, _pancake);
    }

    function validateFees(uint8 venue, uint24[] calldata fees) public view {
        if (venue > Types.PANCAKE || fees.length > 8) revert InvalidDexPolicy();
        for (uint256 i; i < fees.length; ++i) {
            uint24 fee = fees[i];
            if (fee == 0 || fee >= 1_000_000) revert InvalidDexPolicy();
            for (uint256 j; j < i; ++j) {
                if (fees[j] == fee) revert InvalidDexPolicy();
            }
        }
    }

    function validateSpacings(uint8 venue, uint32[] calldata spacings) external view {
        _validateSpacingShape(venue, spacings);
        for (uint256 group; group < 3; ++group) {
            bool requested;
            for (uint256 i; i < spacings.length; ++i) {
                if ((spacings[i] >> 24) == group) requested = true;
            }
            if (!requested) continue;

            address factory = _aerodrome[2 + group * 3];
            if (factory == address(0)) revert InvalidDexPolicy();
            int24[] memory enabled = ISlipstreamFactory(factory).tickSpacings();
            for (uint256 i; i < spacings.length; ++i) {
                if ((spacings[i] >> 24) != group) continue;
                int24 spacing = int24(uint24(spacings[i]));
                bool found;
                for (uint256 j; j < enabled.length; ++j) {
                    if (enabled[j] == spacing) {
                        found = true;
                        break;
                    }
                }
                if (!found) revert InvalidDexPolicy();
            }
        }
    }

    function quote(
        Types.Settings calldata s,
        uint256 amount,
        uint8 venue,
        uint24[] calldata fees,
        uint32[] calldata spacings
    ) external returns (Types.Route memory best, Types.Route[] memory routes) {
        validateFees(venue, fees);
        _validateSpacingShape(venue, spacings);
        if (venue == Types.AERO) {
            routes = new Types.Route[]((s.allowV2 ? 2 : 0) + spacings.length);
            uint256 next;
            if (s.allowV2) {
                routes[next++] = _candidate(s, amount, Types.AERO_VOLATILE, 0);
                routes[next++] = _candidate(s, amount, Types.AERO_STABLE, 0);
            }
            for (uint256 i; i < spacings.length; ++i) {
                uint8 kind = Types.SLIPSTREAM_G1 + uint8(spacings[i] >> 24);
                routes[next++] = _candidate(s, amount, kind, uint24(spacings[i]));
            }
        } else {
            routes = new Types.Route[]((s.allowV2 ? 1 : 0) + fees.length);
            uint8 v2 = venue == Types.UNI ? Types.UNI_V2 : Types.PANCAKE_V2;
            uint8 v3 = venue == Types.UNI ? Types.UNI_V3 : Types.PANCAKE_V3;
            uint256 next;
            if (s.allowV2) routes[next++] = _candidate(s, amount, v2, 0);
            for (uint256 i; i < fees.length; ++i) {
                routes[next++] = _candidate(s, amount, v3, fees[i]);
            }
        }
        for (uint256 i; i < routes.length; ++i) {
            if (routes[i].amountOut > best.amountOut) best = routes[i];
        }
    }

    /// @param input The payment currency of the original buy.
    /// @param output The acquired currency of the original buy.
    function reverseQuote(
        Types.Route calldata route,
        address input,
        address output,
        uint256 amount
    ) external returns (uint256 expected) {
        if (route.pool != address(0) && _pool(route.kind, route.fee, output, input) == route.pool) {
            expected = _amountOut(route, output, input, amount);
        }
    }

    function _validateSpacingShape(uint8 venue, uint32[] calldata spacings) private pure {
        if (venue > Types.PANCAKE || spacings.length > 48 || (venue != Types.AERO && spacings.length != 0)) {
            revert InvalidDexPolicy();
        }
        uint256[3] memory counts;
        for (uint256 i; i < spacings.length; ++i) {
            uint32 encoded = spacings[i];
            uint256 group = encoded >> 24;
            uint24 spacing = uint24(encoded);
            if (group >= 3 || spacing == 0 || spacing >= 16_384 || ++counts[group] > 16) {
                revert InvalidDexPolicy();
            }
            for (uint256 j; j < i; ++j) {
                if (encoded == spacings[j]) revert InvalidDexPolicy();
            }
        }
    }

    function _candidate(
        Types.Settings calldata s,
        uint256 amount,
        uint8 kind,
        uint24 fee
    ) private returns (Types.Route memory route) {
        route.kind = kind;
        route.fee = fee;
        route.pool = _pool(kind, fee, s.tokenIn, s.tokenOut);
        if (route.pool.code.length == 0 || amount == 0) return route;

        (bool ok, bytes memory data) = s.tokenIn.staticcall{gas: READ_GAS}(
            abi.encodeCall(IClassicBalance.balanceOf, (route.pool))
        );
        if (!ok || data.length != 32) return route;
        route.poolInput = abi.decode(data, (uint256));
        if (route.poolInput >= s.minPoolInput) {
            route.amountOut = _amountOut(route, s.tokenIn, s.tokenOut, amount);
        }
    }

    function _pool(uint8 kind, uint24 fee, address input, address output) private view returns (address) {
        if (kind == Types.UNI_V2 || kind == Types.PANCAKE_V2) {
            address factory = kind == Types.UNI_V2 ? _uniswap[1] : _pancake[0];
            if (factory == address(0)) return address(0);
            try IV2Factory(factory).getPair{gas: READ_GAS}(input, output) returns (address pool) {
                return pool;
            } catch {}
        } else if (kind == Types.UNI_V3 || kind == Types.PANCAKE_V3) {
            address factory = kind == Types.UNI_V3 ? _uniswap[3] : _pancake[2];
            if (factory == address(0)) return address(0);
            try IFeePoolFactory(factory).getPool{gas: READ_GAS}(input, output, fee) returns (address pool) {
                return pool;
            } catch {}
        } else if (kind == Types.AERO_VOLATILE || kind == Types.AERO_STABLE) {
            address factory = _aerodrome[0];
            if (factory == address(0)) return address(0);
            try IAerodromeFactory(factory).getPool{gas: READ_GAS}(input, output, kind == Types.AERO_STABLE)
                returns (address pool)
            {
                return pool;
            } catch {}
        } else if (kind >= Types.SLIPSTREAM_G1 && kind <= Types.SLIPSTREAM_G3) {
            address factory = _aerodrome[2 + 3 * (kind - Types.SLIPSTREAM_G1)];
            if (factory == address(0)) return address(0);
            try ISlipstreamFactory(factory).getPool{gas: READ_GAS}(input, output, int24(fee)) returns (address pool) {
                return pool;
            } catch {}
        }
        return address(0);
    }

    function _amountOut(
        Types.Route memory route,
        address input,
        address output,
        uint256 amount
    ) private returns (uint256) {
        uint8 kind = route.kind;
        if (kind == Types.UNI_V2 || kind == Types.PANCAKE_V2) {
            address router = kind == Types.UNI_V2 ? _uniswap[2] : _pancake[1];
            if (router == address(0)) return 0;
            try IV2Router(router).getAmountsOut{gas: READ_GAS}(amount, Types.v2Path(input, output))
                returns (uint256[] memory amounts)
            {
                return amounts.length == 2 ? amounts[1] : 0;
            } catch {}
        } else if (kind == Types.UNI_V3 || kind == Types.PANCAKE_V3) {
            address quoter = kind == Types.UNI_V3 ? _uniswap[5] : _pancake[4];
            if (quoter == address(0)) return 0;
            IFeeQuoter.Quote memory args = IFeeQuoter.Quote(input, output, amount, route.fee, 0);
            try IFeeQuoter(quoter).quoteExactInputSingle{gas: QUOTE_GAS}(args) returns (uint256 out) {
                return out;
            } catch {}
        } else if (kind == Types.AERO_VOLATILE || kind == Types.AERO_STABLE) {
            if (_aerodrome[1] == address(0)) return 0;
            try IAerodromePool(route.pool).getAmountOut{gas: QUOTE_GAS}(amount, input) returns (uint256 out) {
                return out;
            } catch {}
        } else if (kind >= Types.SLIPSTREAM_G1 && kind <= Types.SLIPSTREAM_G3) {
            address quoter = _aerodrome[4 + 3 * (kind - Types.SLIPSTREAM_G1)];
            if (quoter == address(0)) return 0;
            ISlipstreamQuoter.Quote memory args = ISlipstreamQuoter.Quote(input, output, amount, int24(route.fee), 0);
            try ISlipstreamQuoter(quoter).quoteExactInputSingle{gas: QUOTE_GAS}(args) returns (uint256 out) {
                return out;
            } catch {}
        }
        return 0;
    }
}

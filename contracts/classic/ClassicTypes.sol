// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

library ClassicTypes {
    uint8 internal constant UNI = 0;
    uint8 internal constant AERO = 1;
    uint8 internal constant PANCAKE = 2;

    uint8 internal constant UNI_V2 = 1;
    uint8 internal constant UNI_V3 = 2;
    uint8 internal constant AERO_VOLATILE = 3;
    uint8 internal constant AERO_STABLE = 4;
    uint8 internal constant SLIPSTREAM_G1 = 5;
    uint8 internal constant SLIPSTREAM_G3 = 7;
    uint8 internal constant PANCAKE_V2 = 8;
    uint8 internal constant PANCAKE_V3 = 9;

    struct Settings {
        address tokenIn;
        address tokenOut;
        address recipient;
        uint256 minPoolInput;
        uint256 minBuyAmount;
        bool allowV2;
        bool checkBurn;
        uint16 maxBurnBps;
        bool testSell;
        uint16 testSellBps;
    }

    struct Route {
        uint8 kind;
        uint24 fee;
        address pool;
        uint256 amountOut;
        uint256 poolInput;
    }

    function v2Path(address tokenIn, address tokenOut) internal pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
    }
}

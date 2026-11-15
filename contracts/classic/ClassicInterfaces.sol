// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

interface IV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IV2Router {
    function getAmountsOut(uint256 amount, address[] calldata path) external view returns (uint256[] memory);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amount,
        uint256 amountOutMinimum,
        address[] calldata path,
        address recipient,
        uint256 deadline
    ) external;
}

interface IFeePoolFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IFeeQuoter {
    struct Quote {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 priceLimit;
    }

    function quoteExactInputSingle(Quote calldata params) external returns (uint256 amountOut);
}

interface IUniV3Router {
    struct Swap {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 priceLimit;
    }

    function exactInputSingle(Swap calldata params) external payable returns (uint256 amountOut);
}

interface IPancakeV3Router {
    struct Swap {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 priceLimit;
    }

    function exactInputSingle(Swap calldata params) external payable returns (uint256 amountOut);
}

interface IAerodromeFactory {
    function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
}

interface IAerodromePool {
    function getAmountOut(uint256 amount, address tokenIn) external view returns (uint256);
}

interface IAerodromeRouter {
    struct Hop {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amount,
        uint256 amountOutMinimum,
        Hop[] calldata path,
        address recipient,
        uint256 deadline
    ) external;
}

interface ISlipstreamFactory {
    function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address);
    function tickSpacings() external view returns (int24[] memory);
}

interface ISlipstreamQuoter {
    struct Quote {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        int24 tickSpacing;
        uint160 priceLimit;
    }

    function quoteExactInputSingle(Quote calldata params) external returns (uint256 amountOut);
}

interface ISlipstreamRouter {
    struct Swap {
        address tokenIn;
        address tokenOut;
        int24 tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 priceLimit;
    }

    function exactInputSingle(Swap calldata params) external payable returns (uint256 amountOut);
}

interface IClassicBalance {
    function balanceOf(address account) external view returns (uint256);
}

const { Contract, getAddress, ZeroHash } = require("ethers");
const { runtimeMatches } = require("./dex.cjs");

async function validateDependencies(executor, provider, helpers, overrides, chain) {
  const [chainId, wrappedNative, helperAddress] = await Promise.all([
    executor.networkChainId(overrides),
    executor.wrappedNative(overrides),
    executor.quoteHelper(overrides)
  ]);
  if (Number(chainId) !== chain.chainId || getAddress(wrappedNative) !== getAddress(chain.addresses.weth)) {
    throw Error("V4 执行器网络或包装币固定配置不符");
  }

  const code = await provider.getCode(helperAddress, overrides.blockTag);
  const artifact = helpers.find(helper => runtimeMatches(code, helper));
  if (!artifact) throw Error("V4 报价辅助合约代码不匹配");

  const helper = new Contract(helperAddress, artifact.abi, provider);
  const [config, controller, executorAddress] = await Promise.all([
    helper.getV4Config(overrides),
    helper.controller(overrides),
    executor.getAddress()
  ]);
  const expected = chain.v4.config;
  if (config.length !== expected.length ||
      !config.every((value, index) => getAddress(value) === getAddress(expected[index])) ||
      getAddress(controller) !== getAddress(executorAddress)) {
    throw Error("V4 报价辅助合约的固定配置或控制者不匹配");
  }
}

async function policy(executor) {
  const [[dex], [pools, lockedPoolId]] = await Promise.all([
    executor.getDexPolicy(),
    executor.getV4Policy()
  ]);
  return {
    dex: Number(dex),
    v4Pools: pools.map(pool => ({
      kind: Number(pool.kind),
      currency0: pool.currency0,
      currency1: pool.currency1,
      hooks: pool.hooks,
      fee: Number(pool.fee),
      tickSpacing: Number(pool.tickSpacing),
      parameters: pool.parameters,
      poolId: pool.poolId
    })),
    lockedPoolId: lockedPoolId || ZeroHash
  };
}

module.exports = { policy, validateDependencies };

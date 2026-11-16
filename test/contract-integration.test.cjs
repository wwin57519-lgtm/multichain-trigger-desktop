const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { Interface, Transaction, Wallet, getAddress, ZeroAddress, ZeroHash } = require("ethers");
const { WebSocketServer } = require("ws");
const { Engine } = require("../src/engine.cjs");
const { Monitor } = require("../src/monitor.cjs");
const { rebuiltArtifact, identifyExecutor } = require("../src/contract-artifacts.cjs");
const { normalize: normalizePool } = require("../src/v4-pools.cjs");
const { clEvent } = require("../src/v4-liquidity.cjs");

const oldExecutor = require("../artifacts/BaseSwapExecutor.json");
const oldHelper = require("../artifacts/ProtocolQuoteHelper.json");
const newHelper = require("../artifacts/RebuiltProtocolQuoteHelper.json");
const priorExecutor = require("../artifacts/Rebuilt010BaseSwapExecutor.json");
const priorHelper = require("../artifacts/Rebuilt010ProtocolQuoteHelper.json");
const historicalV4 = require("../artifacts/V4SwapExecutor.json");
const historicalV4Helper = require("../artifacts/V4QuoteHelper.json");
const rebuiltV4 = require("../artifacts/RebuiltV4SwapExecutor.json");
const rebuiltV4Helper = require("../artifacts/RebuiltV4QuoteHelper.json");
const priorV4 = require("../artifacts/Rebuilt010V4SwapExecutor.json");
const priorV4Helper = require("../artifacts/Rebuilt010V4QuoteHelper.json");
const target = getAddress("0x" + "11".repeat(20));
const helper = getAddress("0x" + "22".repeat(20));
const owner = getAddress("0x" + "33".repeat(20));
const rpcUrl = "https://rpc.invalid/";
const block = { number: 123, timestamp: 1800000000, baseFeePerGas: 1n };
const epoch = 17n;

function deployedCode(artifact) {
  const bytes = Buffer.from(artifact.deployedBytecode.slice(2), "hex");
  for (const references of Object.values(artifact.immutableReferences || {})) {
    for (const { start, length } of references) bytes.fill(19, start, start + length);
  }
  return "0x" + bytes.toString("hex");
}

function makeEngine(EngineClass = Engine) {
  return new EngineClass({ vault: { list: () => [], info: () => ({ locked: true }) } });
}

function fixture(engine, executorArtifact, helperArtifact, changes = {}) {
  const chain = engine.chain;
  const addresses = chain.addresses;
  const expected = [addresses.weth, addresses.v2Factory, addresses.v2Router,
    addresses.v3Factory, addresses.v3Router, addresses.quoter];
  const aero = chain.aerodrome?.config || Array(11).fill(ZeroAddress);
  const strict = executorArtifact === rebuiltArtifact || executorArtifact === rebuiltV4;
  const executorValues = {
    owner: [owner], networkChainId: [chain.chainId], wrappedNative: [addresses.weth],
    v2Factory: [addresses.v2Factory], v2Router: [addresses.v2Router],
    v3Factory: [addresses.v3Factory], v3Router: [addresses.v3Router],
    quoterV2: [addresses.quoter], getAerodromeConfig: [aero],
    getPancakeConfig: [chain.pancake?.config],
    aerodromeQuoteHelper: [helper], quoteHelper: [helper],
    executed: [false], triggerArmed: [true], triggerEpoch: [epoch],
    getTriggerPolicy: [[1n, strict ? 10000n : 250n, block.timestamp - 1, block.timestamp + 600]],
    getDexPolicy: [0, []], isTriggerWallet: [true], trigger: [1n, 1n, 0n],
    ...changes.executor
  };
  const helperValues = {
    getConfig: [aero], getNetworkConfig: [expected, aero, chain.pancake?.config],
    getV4Config: [chain.v4?.config], controller: [target],
    ...changes.helper
  };
  const executorInterface = new Interface(executorArtifact.abi);
  const helperInterface = new Interface(helperArtifact.abi);
  const provider = {
    getNetwork: async () => ({ chainId: BigInt(chain.chainId) }),
    async getCode(address) {
      if (address === target) return changes.code || deployedCode(executorArtifact);
      if (address === helper) return deployedCode(helperArtifact);
      return "0x6000";
    },
    async call({ to, data }) {
      const [iface, values] = to === target ? [executorInterface, executorValues] : [helperInterface, helperValues];
      const parsed = iface.parseTransaction({ data });
      assert.ok(parsed && Object.hasOwn(values, parsed.name), "Unexpected test RPC call");
      return iface.encodeFunctionResult(parsed.fragment, values[parsed.name]);
    }
  };
  if (typeof engine.contractAt === "function") {
    engine.pool = {
      primary: provider,
      urls: [rpcUrl],
      rps: 20,
      providers: [provider],
      destroy() {},
      read(method, arg) {
        if (method === "getCode") return provider.getCode(arg);
        if (method === "getBlock") return block;
        if (method === "getBalance") return 10n ** 18n;
        if (method === "getTransactionCount") return 0;
        if (method === "call") return provider.call(arg);
        throw Error("Unexpected test RPC method " + method);
      }
    };
  } else {
    engine.provider = provider;
  }
  return provider;
}

function load(engine, options) {
  if (typeof engine.contractAt === "function") return engine.contractAt(target);
  return engine.validateContract(target, options);
}

test("runtime verification recognizes exact historical executors and masks immutable bytes", () => {
  const versions = [["0.7.0", "BaseSwapExecutor"], ["0.6.2", "Release062BaseSwapExecutor"], ["0.6.1", "Release061BaseSwapExecutor"], ["0.6.0", "PreviousBaseSwapExecutor"], ["0.5.0", "LegacyBaseSwapExecutor"]];
  for (const [version, name] of versions) {
    const artifact = require("../artifacts/" + name + ".json");
    assert.equal(identifyExecutor(deployedCode(artifact)).version, version);
  }
  const rebuilt = identifyExecutor(deployedCode(rebuiltArtifact));
  assert.equal(rebuilt.version, "重写版 0.2.0");
  assert.strictEqual(rebuilt.helpers[0], newHelper);
  const prior = identifyExecutor(deployedCode(priorExecutor));
  assert.equal(prior.version, "重写版 0.1.0");
  assert.strictEqual(prior.helpers[0], priorHelper);
  const code = deployedCode(rebuiltArtifact);
  const changed = "0x" + (code.slice(2, 4) === "00" ? "01" : "00") + code.slice(4);
  assert.equal(identifyExecutor(changed), null);
});

test("contract loading accepts historical and rebuilt releases and enforces their quote helpers", async (t) => {
  for (const EngineClass of [Engine]) {
    const engine = makeEngine(EngineClass);
    t.after(() => clearInterval(engine.pollTimer));
    fixture(engine, rebuiltArtifact, newHelper);
    const current = await load(engine);
    assert.equal(current.verifiedVersion, "重写版 0.2.0");
    assert.equal(current.strictTriggerLimits, true);
    assert.equal(current.verifiedFamily, "classic");
    assert.equal(await current.owner(), owner);

    fixture(engine, priorExecutor, priorHelper);
    const prior = await load(engine);
    assert.equal(prior.verifiedVersion, "重写版 0.1.0");
    assert.equal(prior.strictTriggerLimits, false);
    fixture(engine, rebuiltArtifact, priorHelper);
    await assert.rejects(() => load(engine), /报价辅助合约代码|辅助合约代码不符/);

    fixture(engine, oldExecutor, oldHelper);
    assert.equal((await load(engine)).verifiedVersion, "0.7.0");

    fixture(engine, rebuiltArtifact, oldHelper);
    await assert.rejects(() => load(engine), /报价辅助合约代码|辅助合约代码不符/);
    fixture(engine, oldExecutor, oldHelper, { executor: { networkChainId: [97] } });
    await assert.rejects(() => load(engine), /链标识|执行器网络/);
  }
});

test("the trigger API encodes the same round parameter for old and rebuilt executors", (t) => {
  const engine = makeEngine();
  t.after(() => clearInterval(engine.pollTimer));
  assert.strictEqual(engine.artifact, rebuiltArtifact);
  const legacyInterface = new Interface(oldExecutor.abi);
  const expected = legacyInterface.encodeFunctionData("trigger", [epoch]);
  for (const artifact of [engine.artifact, priorExecutor, historicalV4, priorV4, rebuiltV4]) {
    assert.equal(new Interface(artifact.abi).encodeFunctionData("trigger", [epoch]), expected);
  }
});

function v4Fixture(engine, executor, quoteHelper, overrides = {}) {
  const token = getAddress("0x" + "44".repeat(20));
  const pool = normalizePool({
    kind: 10, currency0: ZeroAddress, currency1: token, hooks: ZeroAddress,
    fee: 500, tickSpacing: 10, parameters: ZeroHash
  }, engine.chain);
  fixture(engine, executor, quoteHelper, {
    executor: {
      getSettings: [[engine.chain.addresses.weth, token, owner, 0, 1n, false, 0, false, 0]],
      getV4Policy: [[pool], pool.poolId],
      ...overrides.executor
    },
    helper: overrides.helper
  });
  return pool;
}

test("the standalone trigger reads original and rebuilt V4 executors on all supported chains", async (t) => {
  const engine = makeEngine();
  t.after(() => clearInterval(engine.pollTimer));
  for (const chainId of [1, 56, 8453]) {
    await engine.invoke("network.select", { chainId });
    for (const [executor, helper, version] of [
      [historicalV4, historicalV4Helper, "1.0.0"],
      [priorV4, priorV4Helper, "重写版 0.1.0"],
      [rebuiltV4, rebuiltV4Helper, "重写版 0.2.0"]
    ]) {
      const pool = v4Fixture(engine, executor, helper);
      const inspected = await engine.invoke("contract.inspect", { address: target });
      assert.equal(inspected.family, "v4");
      assert.equal(inspected.version, version);
      assert.equal(inspected.strictTriggerLimits, executor === rebuiltV4);
      assert.equal(inspected.triggerEpoch, String(epoch));
      assert.deepEqual(inspected.v4Pools, [pool]);
      assert.equal(inspected.lockedPoolId, pool.poolId);
    }
  }
});

test("V4 loading requires the paired helper and its controller, configuration and network", async (t) => {
  const engine = makeEngine();
  t.after(() => clearInterval(engine.pollTimer));

  v4Fixture(engine, rebuiltV4, historicalV4Helper);
  await assert.rejects(() => load(engine), /V4 报价辅助合约代码/);
  v4Fixture(engine, rebuiltV4, rebuiltV4Helper, { helper: { controller: [owner] } });
  await assert.rejects(() => load(engine), /固定配置或控制者/);
  v4Fixture(engine, rebuiltV4, rebuiltV4Helper, {
    helper: { getV4Config: [Array(engine.chain.v4.config.length).fill(ZeroAddress)] }
  });
  await assert.rejects(() => load(engine), /固定配置或控制者/);
  v4Fixture(engine, historicalV4, historicalV4Helper, { executor: { networkChainId: [1] } });
  await assert.rejects(() => load(engine), /V4 执行器网络/);
});

test("task preview requires positive input and a fixed receipt minimum for the rebuilt executor", async (t) => {
  const engine = makeEngine();
  t.after(() => clearInterval(engine.pollTimer));
  const config = { contractAddress: target, rpcUrls: [rpcUrl], mode: "probe" };
  const preview = () => engine.invoke("task.preview", { config });
  v4Fixture(engine, rebuiltV4, rebuiltV4Helper, {
    executor: { getTriggerPolicy: [[0n, 10000n, block.timestamp - 1, block.timestamp + 600]] }
  });
  await assert.rejects(preview, /正数投入金额和固定最低实收/);
  v4Fixture(engine, rebuiltV4, rebuiltV4Helper, {
    executor: {
      getSettings: [[engine.chain.addresses.weth, owner, owner, 0, 0n, false, 0, false, 0]]
    }
  });
  await assert.rejects(preview, /正数投入金额和固定最低实收/);
});

test("V4 tasks use the on-chain pools and sign the verified executor round through the normal entry point", async (t) => {
  const signer = Wallet.createRandom();
  const engine = new Engine({
    vault: {
      list: () => [{ address: signer.address }],
      getSigner: (address) => {
        assert.equal(address, signer.address);
        return signer;
      },
      lock() {}
    }
  });
  t.after(() => engine.close());
  const pool = v4Fixture(engine, rebuiltV4, rebuiltV4Helper);
  const config = { contractAddress: target, rpcUrls: [rpcUrl], walletLimit: 1, concurrency: 1 };

  const preview = await engine.invoke("task.preview", { config: {
    ...config, mode: "listen", monitorRpc: "wss://rpc.invalid/", listenLiquidity: true,
    contractFamily: "classic", v4Pools: [], lockedPoolId: ZeroHash
  } });
  assert.equal(preview.readyWalletCount, 1);
  assert.equal(engine.config.contractFamily, "v4");
  assert.deepEqual(engine.config.v4Pools, [pool]);
  assert.equal(engine.config.lockedPoolId, pool.poolId);

  const submitted = [];
  engine.pool.broadcast = async (raw) => {
    const tx = Transaction.from(raw);
    submitted.push(tx);
    return { hash: tx.hash };
  };
  await engine.invoke("task.start", { config: { ...config, mode: "probe", maxAttempts: 1 } });
  await Promise.all([...engine.run.operations]);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].chainId, BigInt(engine.chain.chainId));
  assert.equal(submitted[0].from, signer.address);
  assert.equal(submitted[0].to, target);
  const decoded = new Interface(rebuiltV4.abi).decodeFunctionData("trigger", submitted[0].data);
  assert.equal(decoded[0], epoch);
  assert.equal(engine.publicJournal()[0].status, "pending");
});

test("V4 monitoring subscribes to the saved pool and checks its log against the receipt", { timeout: 5000 }, async (t) => {
  const engine = makeEngine();
  t.after(() => clearInterval(engine.pollTimer));
  const pool = v4Fixture(engine, historicalV4, historicalV4Helper);
  const manager = engine.chain.v4.manager;
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  t.after(() => {
    for (const socket of server.clients) socket.terminate();
    return new Promise(resolve => server.close(resolve));
  });
  await once(server, "listening");
  let connection;
  let filter;
  server.on("connection", socket => {
    connection = socket;
    socket.on("message", raw => {
      const { id, method, params } = JSON.parse(raw.toString());
      let result = "pending";
      if (method === "eth_chainId") result = "0x2105";
      if (params[0] === "logs") {
        filter = params[1];
        result = "v4-logs";
      }
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });

  const event = clEvent.encodeEventLog(clEvent.getEvent("ModifyLiquidity"), [
    pool.poolId, owner, -10, 10, 20n, ZeroHash
  ]);
  const log = {
    ...event, transactionHash: "0x" + "aa".repeat(32), blockHash: "0x" + "bb".repeat(32),
    logIndex: 0, blockNumber: block.number, address: manager, removed: false
  };
  const receipt = {
    hash: log.transactionHash, blockHash: log.blockHash, blockNumber: block.number,
    from: owner, to: engine.chain.v4.positionManager, status: 1, logs: [log]
  };
  const calls = [];
  const { promise: matched, resolve: onMatch } = Promise.withResolvers();
  const monitor = new Monitor({
    url: "ws://127.0.0.1:" + server.address().port,
    config: {
      chainId: engine.chain.chainId, contractFamily: "v4", listenLiquidity: true,
      v4Pools: [pool], lockedPoolId: pool.poolId
    },
    pool: { read(method, argument) {
      calls.push([method, argument]);
      if (method === "getTransactionReceipt") return receipt;
      if (method === "getBlock") return { ...block, hash: log.blockHash };
      throw Error("Unexpected monitor RPC method " + method);
    } },
    onMatch
  });
  t.after(() => monitor.stop());
  await monitor.start();
  assert.deepEqual(filter.address, [manager]);
  assert.deepEqual(filter.topics[1], [pool.poolId]);

  for (const subscription of ["unrelated-stream", "v4-logs"]) {
    connection.send(JSON.stringify({
      jsonrpc: "2.0", method: "eth_subscription", params: { subscription, result: log }
    }));
  }
  const match = await matched;
  assert.equal(match.poolId, pool.poolId);
  assert.equal(match.tx.hash, log.transactionHash);
  assert.deepEqual(calls, [
    ["getTransactionReceipt", log.transactionHash], ["getBlock", block.number]
  ]);
});

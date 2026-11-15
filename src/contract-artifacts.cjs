const { runtimeMatches } = require("./dex.cjs");

const rebuiltArtifact = require("../artifacts/RebuiltBaseSwapExecutor.json");
const rebuiltHelper = require("../artifacts/RebuiltProtocolQuoteHelper.json");
const historicalHelpers = [
  require("../artifacts/ProtocolQuoteHelper.json"),
  require("../artifacts/Release062AerodromeQuoteHelper.json"),
  require("../artifacts/Release061AerodromeQuoteHelper.json"),
  require("../artifacts/PreviousAerodromeQuoteHelper.json")
];

const versions = [
  { version: "重写版 0.1.0", artifact: rebuiltArtifact, helpers: [rebuiltHelper] },
  { version: "0.7.0", artifact: require("../artifacts/BaseSwapExecutor.json"), helpers: historicalHelpers },
  { version: "0.6.2", artifact: require("../artifacts/Release062BaseSwapExecutor.json"), helpers: historicalHelpers },
  { version: "0.6.1", artifact: require("../artifacts/Release061BaseSwapExecutor.json"), helpers: historicalHelpers },
  { version: "0.6.0", artifact: require("../artifacts/PreviousBaseSwapExecutor.json"), helpers: historicalHelpers },
  { version: "0.5.0", artifact: require("../artifacts/LegacyBaseSwapExecutor.json"), helpers: [] }
];

function identifyExecutor(code, override) {
  const known = versions.find(entry => runtimeMatches(code, entry.artifact));
  if (known) return known;
  if (override && runtimeMatches(code, override)) {
    return { version: "自定义", artifact: override, helpers: historicalHelpers };
  }
  return null;
}

module.exports = { rebuiltArtifact, identifyExecutor };

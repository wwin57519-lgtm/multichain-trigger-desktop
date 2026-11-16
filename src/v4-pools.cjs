'use strict';
const { AbiCoder, ZeroAddress, ZeroHash, getAddress, keccak256, toBeHex } = require('ethers');
const uniKey='tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)';
const infinityKey='tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters)';
const coder=AbiCoder.defaultAbiCoder();
function addr(a){return getAddress(String(a??ZeroAddress));}
function manager(kind,chain){if(kind===10)return chain.v4.manager;const inf=chain.v4.infinity;if(!inf)throw Error('Ethereum 尚未配置 PancakeSwap Infinity');return kind===11?inf.clManager:kind===12?inf.binManager:null;}
function normalize(value,chain,{tokenIn,tokenOut,dex}={}) {
 if(!value||typeof value!=='object')throw Error('需要完整 PoolKey');const kind=Number(value.kind);
 if(value.chainId!==undefined&&Number(value.chainId)!==chain.chainId)throw Error('PoolKey 网络与当前网络不匹配');
 if(typeof value.currency0!=='string'||typeof value.currency1!=='string'||typeof value.hooks!=='string')throw Error('完整 PoolKey 必须显式提供 currency0、currency1 和 hooks');
 if(![10,11,12].includes(kind))throw Error('V4 池型无效');const m=addr(manager(kind,chain));
 if(value.manager&&addr(value.manager)!==m)throw Error('PoolManager 与当前网络官方配置不符');
 if(dex!==undefined&&((Number(dex)===0&&kind!==10)||(Number(dex)===2&&kind===10)||Number(dex)===1))throw Error('Pool ID 不属于所选交易所');
 const p={kind,currency0:addr(value.currency0),currency1:addr(value.currency1),hooks:addr(value.hooks),fee:Number(value.fee),tickSpacing:Number(value.tickSpacing??0),parameters:value.parameters??ZeroHash,poolId:value.poolId??ZeroHash};
 if(p.hooks!==ZeroAddress)throw Error('首版不支持有 Hook 的池');
 if(BigInt(p.currency0)>=BigInt(p.currency1))throw Error('PoolKey 币对排序无效');
 if(!Number.isInteger(p.fee)||p.fee<0||p.fee>=1000000)throw Error('无 Hook 池需要固定费率');
 if(!/^0x[0-9a-f]{64}$/i.test(p.parameters))throw Error('parameters 必须是 bytes32');
 if(kind===10){if(p.parameters!==ZeroHash||!Number.isInteger(p.tickSpacing)||p.tickSpacing<=0||p.tickSpacing>=32768)throw Error('Uniswap tickSpacing 无效');}
 else {
  if(value.parameters===undefined){const n=kind===11?p.tickSpacing:Number(value.binStep);if(!Number.isInteger(n)||n<=0)throw Error('请填写 tickSpacing 或 binStep');p.parameters=toBeHex(BigInt(n)<<16n,32);}
  const bits=BigInt(p.parameters),spacing=bits>>16n;
  if((bits&65535n)!==0n||spacing===0n)throw Error('无 Hook 参数包含非法标志');
  if(kind===11){if(spacing>=32768n)throw Error('tickSpacing 无效');p.tickSpacing=Number(spacing);}
  else if(p.tickSpacing!==0||spacing>100n||p.fee>100000)throw Error('Bin binStep 或费率无效');
 }
 const key=kind===10?[p.currency0,p.currency1,p.fee,p.tickSpacing,p.hooks]:[p.currency0,p.currency1,p.hooks,m,p.fee,p.parameters];
 const id=keccak256(coder.encode([kind===10?uniKey:infinityKey],[key]));
 if(value.poolId&&value.poolId!==ZeroHash&&String(value.poolId).toLowerCase()!==id)throw Error('Pool ID 与 PoolKey 不匹配');p.poolId=id;
 const assets=[p.currency0,p.currency1].map(a=>a===ZeroAddress?addr(chain.addresses.weth):a);
 if(assets[0]===assets[1])throw Error('池币对不能是原生币与同一包装币');
 if(tokenIn&&tokenOut&&(!assets.includes(addr(tokenIn))||!assets.includes(addr(tokenOut))))throw Error('PoolKey 与设置的支付／获得币不匹配');
 return p;
}

module.exports = { uniKey, infinityKey, normalize, manager };

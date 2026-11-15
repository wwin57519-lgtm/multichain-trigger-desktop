const {Contract,getAddress,ZeroAddress}=require('ethers');
const CONFIG=require('./config.cjs');
const FACTORY_ABI=['function tickSpacings() view returns(int24[])'];
function venue(value=0){if(value===0||value==='0'||value==='Uniswap')return 0;if(value===1||value==='1'||value==='Aerodrome')return 1;if(value===2||value==='2'||value==='PancakeSwap')return 2;throw Error('交易所必须为 Uniswap、Aerodrome 或 PancakeSwap');}
function defaultFees(value=0){return venue(value)===2?[100,500,2500,10000]:[100,500,3000,10000];}
function modern(c){return !!c.interface?.hasFunction('getDexPolicy');}
function runtimeMatches(code,artifact){
 if(typeof code!=='string'||code.length!==artifact.deployedBytecode.length)return false;
 const a=code.slice(2).toLowerCase().split(''),b=artifact.deployedBytecode.slice(2).toLowerCase().split('');
 for(const refs of Object.values(artifact.immutableReferences||{}))for(const {start,length} of refs)for(let i=start*2;i<(start+length)*2;i++)a[i]=b[i]='0';
 return a.join('')===b.join('');
}
function same(actual,expected){return actual.length===expected.length&&actual.every((x,i)=>getAddress(x)===getAddress(expected[i]));}
async function validateDependencies(c,p,helperArtifact,overrides={},chain=CONFIG){
 const multichain=!!c.interface?.hasFunction('getPancakeConfig');
 if(!multichain&&chain.chainId!==8453)throw Error('旧版合约只允许在 Base 使用');
 const expected=['weth','v2Factory','v2Router','v3Factory','v3Router','quoter'].map(k=>chain.addresses[k]);
 const actual=await Promise.all(['wrappedNative','v2Factory','v2Router','v3Factory','v3Router','quoterV2'].map(g=>c[g](overrides)));
 if(!same(actual,expected))throw Error('执行器 Uniswap 固定依赖与当前网络官方配置不符');
 if(multichain){if(Number(await c.networkChainId(overrides))!==chain.chainId)throw Error('执行器链标识不符');if(!same(await c.getPancakeConfig(overrides),chain.pancake.config))throw Error('执行器 PancakeSwap 固定依赖不符');}
 if(!modern(c))return;
 const aero=chain.aerodrome?.config||Array(11).fill(ZeroAddress);
 if(!same(await c.getAerodromeConfig(overrides),aero))throw Error('执行器 Aerodrome 固定依赖不符');
 const helper=await c.aerodromeQuoteHelper(overrides),code=await p.getCode(helper,overrides.blockTag);
 const accepted=(Array.isArray(helperArtifact)?helperArtifact:[helperArtifact]).find(a=>runtimeMatches(code,a));if(!accepted)throw Error('报价辅助合约代码不匹配');
 const h=new Contract(helper,accepted.abi,p);
 if(multichain){if(!h.interface.hasFunction('getNetworkConfig'))throw Error('报价辅助合约版本不匹配');const [u,a,pan]=await h.getNetworkConfig(overrides);if(!same(u,expected)||!same(a,aero)||!same(pan,chain.pancake.config))throw Error('报价辅助合约依赖不匹配');}
 else if(!same(await h.getConfig(overrides),aero))throw Error('报价辅助合约工厂、Router 或 Quoter 不匹配');
}
async function candidates(p,selected,onlyClassic=false,overrides={},chain=CONFIG){
 if(venue(selected)!==1||onlyClassic)return [];
 if(!chain.aerodrome)throw Error('Aerodrome 仅支持 Base');
 const lists=await Promise.all(chain.aerodrome.cl.map(async(g,index)=>{
  const ticks=(await new Contract(g.factory,FACTORY_ABI,p).tickSpacings(overrides)).map(Number);
  if(ticks.length>16||new Set(ticks).size!==ticks.length||ticks.some(t=>!Number.isInteger(t)||t<=0||t>=16384))throw Error('Slipstream 候选配置异常，停止保存');
  return ticks.sort((a,b)=>a-b).map(t=>index*16777216+t);
 }));return lists.flat();
}
async function policy(c,overrides={}){
 if(!modern(c))return {dex:0,clCandidates:[],onlyClassic:false,legacy:true};
 const [d,ticks]=await c.getDexPolicy(overrides);return {dex:Number(d),clCandidates:ticks.map(Number),onlyClassic:Number(d)===1&&ticks.length===0,legacy:false};
}
function route(r){
 const k=Number(r.kind),cl=k>=5&&k<=7,index=cl?k-5:0;
 return {kind:k===1||k===8?'V2':k===2||k===9?'V3':k===3?'Aerodrome 波动池':k===4?'Aerodrome 稳定池':cl?`Slipstream G${index+1}`:'NONE',dex:k===8||k===9?2:k>=3&&k<=7?1:0,factoryIndex:index,tickSpacing:cl?Number(r.fee):0,stable:k===4,fee:cl?0:Number(r.fee||0),pool:r.pool};
}
module.exports={venue,defaultFees,modern,candidates,policy,route,validateDependencies,runtimeMatches};

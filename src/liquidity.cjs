const {Interface}=require('ethers');
const CONFIG=require('./config.cjs');
const uni=new Interface([
 'function addLiquidity(address tokenA,address tokenB,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline)',
 'function addLiquidityETH(address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable'
]);
const aero=new Interface([
 'function addLiquidity(address tokenA,address tokenB,bool stable,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline)',
 'function addLiquidityETH(address token,bool stable,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable'
]);
const positions=new Interface([
 'function mint((address token0,address token1,int24 tickSpacing,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline,uint160 sqrtPriceX96) params) payable',
 'function mint((address token0,address token1,int24 tickSpacing,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable',
 'function increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) payable',
 'function positions(uint256) view returns(uint96,address,address token0,address token1,int24,int24,int24,uint128,uint256,uint256,uint128,uint128)',
 'function multicall(bytes[] data) payable',
 'function multicall(uint256 deadline,bytes[] data) payable',
 'function multicall(bytes32 previousBlockhash,bytes[] data) payable'
]);
const v3Positions=new Interface(['function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable', 'function positions(uint256) view returns(uint96,address,address token0,address token1,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)',...positions.fragments.filter(f=>!['mint','positions'].includes(f.name)).map(f=>f.format('full'))]);
const lower=x=>String(x||'').toLowerCase();
function actions(config,tx){
 if(!config.listenLiquidity||!tx?.to||config.liquidityFrom&&lower(tx.from)!==lower(config.liquidityFrom))return [];
 const chain=CONFIG.forChain(config.chainId??8453),target=lower(tx.to),isAero=config.liquidityDex==='Aerodrome';
 const nft=isAero?chain.aerodrome?.cl.some(g=>lower(g.positionManager)===target):lower(config.liquidityDex==='PancakeSwap'?chain.pancake.positionManager:chain.positionManager)===target;
 if(!nft&&target!==lower(config.liquidityRouter))return [];
 const iface=nft?(isAero?positions:v3Positions):isAero?aero:uni,out=[];let count=0;
 function visit(data,depth=0){
  if(depth>4||++count>128||typeof data!=='string'||data.length>2*1024*1024)return;
  let call;try{call=iface.parseTransaction({data});}catch{return;}if(!call)return;
  if(call.name==='multicall'){for(const child of call.args.data)visit(child,depth+1);return;}
  if(call.name==='mint'){const p=call.args.params;if(p.amount0Desired||p.amount1Desired)out.push({tokens:[p.token0,p.token1],action:'Slipstream mint'});return;}
  if(call.name==='increaseLiquidity'){const p=call.args.params;if(p.amount0Desired||p.amount1Desired)out.push({manager:target,tokenId:String(p.tokenId),action:'Slipstream increaseLiquidity'});return;}
  if(call.name==='addLiquidity'&&(call.args.amountADesired||call.args.amountBDesired))out.push({tokens:[call.args.tokenA,call.args.tokenB],action:isAero?'Aerodrome addLiquidity':'Uniswap addLiquidity'});
  if(call.name==='addLiquidityETH'&&(call.args.amountTokenDesired||BigInt(tx.value||0)))out.push({tokens:[call.args.token,chain.addresses.weth],action:isAero?'Aerodrome addLiquidityETH':'Uniswap addLiquidityETH'});
 }
 visit(tx.input||tx.data);return out;
}
function matches(config,item){
 if(item.tokens)return item.tokens.some(t=>lower(t)===lower(config.liquidityToken));
 return (config.positionIds?.[item.manager]||[]).includes(item.tokenId);
}
async function position(config,item,pool){
 const iface=config.liquidityDex==='Aerodrome'?positions:v3Positions;
 const data=iface.encodeFunctionData('positions',[item.tokenId]);
 const raw=await pool.read('call',{to:item.manager,data});
 const result=iface.decodeFunctionResult('positions',raw);
 return {tokens:[result.token0,result.token1]};
}
module.exports={actions,matches,position,uni,aero,positions,v3Positions};

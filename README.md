# MultiChain Trigger Desktop

通过已获所有者授权的本地钱包管理链上触发任务。 当前版本 0.5.4。

支持 MultiChain Swap 和 V4 Trading 部署的执行器，包括两套合约的重写版和已知历史版。

所有者在对应的交易工具中设置合约、授权触发钱包并开启本轮。在本应用里选择同一网络、连接 RPC、读取执行合约地址，再使用已获授权的触发钱包预览任务。V4 监听使用合约保存的候选池和锁定池。

## 开发与构建

使用 Node.js 24、npm 和 Electron 44.5.1。

```powershell
npm ci
npm test
npm run smoke
npm run dist:win
```

源码位于 `src/` 和 `renderer/`。Windows x64 安装包生成在 `dist/`。启动检查使用独立的测试配置。

## 合约源码与兼容性

本工程包含经典执行器及其报价合约的 Solidity 源码。运行 `npm run build:contracts` 可用 Solidity 0.8.38 重编译经典合约产物。V4 的执行器和报价合约产物从 V4 Trading 同版本源码携带，经典和 V4 的初版重写源码见 [合约提交 4161a3c](https://github.com/wwin57519-lgtm/multichain-desktop-contracts/tree/4161a3c70b059457596ffc35b2060808581d7a1b)

执行器重写版 0.2.0 要求自动触发前设置正数投入金额和固定最低实收。执行器在兑换、试卖和转账完成后核对收款地址实际到账。本应用保留对 0.1.0 及历史合约的识别和原有操作。部署 0.2.0 会生成独立地址。

## 许可

项目采用 [MIT 许可证](LICENSE)。第三方许可和归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

# ETF本地单体应用

Vue3＋TypeScript＋Vite负责页面，Hono负责同一进程内的接口路由，Node.js内置SQLite驱动直接只读查询`../data/etf.sqlite3`。页面与接口使用同一地址，没有单独的Python服务、代理或跨域配置。

## 启动

需要Node.js24或更高版本。首次运行安装依赖：

```powershell
cd frontend
npm ci
npm run dev
```

打开终端输出的地址，通常为`http://127.0.0.1:5173/`。只需要这一个应用进程。使用构建后的页面可以执行`npm start`，同样同时提供页面与数据库查询。

页面直接查询本地数据库，每60秒检查变化，重新切回页面时也立即检查。无变化时通过ETag返回304；发现新日期、同日修订或口径变化时自动更新，保留当前选中日期、ETF、比较区间、详情展开状态及自定义日期范围。预设近1月/近3月随最新日期前移。

刷新页面后取消选中日期，恢复默认浏览，其余时间范围等偏好继续保留。0AMV触发记录用醒目的红色“多”或绿色“空”徽标显示，上涨区分单日涨超4%与连续两日涨超4%。
单击总份额或增减率图表中的日期可选中，再次单击同一选中日期则取消选择并回到最新数据日；点击其他日期直接切换选择。取消时自定义窗口保持跨度并平移到末尾，预设范围继续使用原预设。

顶部四张卡跟随所选历史日期：总份额及前日变化、单日增减率及前日百分点变化、指南针0AMV当日涨跌幅、申赎异动及份额变化广度。0AMV卡片展示截至参照日的最近阈值触发记录；默认浏览时另以小字标注独立最新已收盘数据，手动选择历史日期时隐藏小字，拖动视口仍保留所选日期。异动强度保留不同ETF增减相抵的变化，并与此前60个交易日比较；广度显示增加、减少、持平及待齐/复核的只数。指标口径及0AMV导入、定时补采命令见[指标说明](docs/metrics-design.md)。

## 查询代码组织

```text
local/
  app.ts                         组装共享依赖和路由，统一错误响应
  plugin.ts                      接入Vite开发/构建预览，使用同一个端口
  db/connection.ts               只读连接、事务快照、超时及连接释放
  repositories/etfRepository.ts   SQL及数据库记录映射
  services/dashboardService.ts    页面数据组装、基金元数据、版本计算
  routes/dashboard.ts            HTTP请求与响应，不含SQL
```

数据库连接由`createReadDatabase(path)`统一创建。每次查询开启短读事务，多个SELECT使用同一数据库快照，查询完成后关闭连接；数据采集可以独立提交更新。读取接口不会创建数据库、建表、迁移或写入数据。`POST /api/amv/sync`针对所选日期或独立最新已收盘日期缺失的0AMV调用独立Python采集命令，无需同日ETF记录；补采完成后保存到同一SQLite的独立表，失败时保留已有数据并限频重试。

`createApi(databasePath)`是本地查询模块的入口，也是接口集成测试入口。Repository接收数据库依赖，业务模块接收Repository，路由接收业务模块，依赖在`app.ts`中一次组装；不引入全局连接变量或依赖注入容器。

新增接口时，在`routes/`注册路由并在`app.ts`挂载；已有数据查询复用Repository，需要新查询时集中在对应Repository中实现。新的数据领域可以新增对应Repository与业务模块，共用`db/connection.ts`。筛选参数应在路由层校验，查询使用绑定参数，禁止把参数拼接进SQL。

当前数据库结构稳定、查询简单，采用原生SQLite即可。Hono提供路由组织和统一错误处理；暂不引入ORM和数据库迁移组件，避免两套程序争用表结构管理。基金元数据统一维护在根目录`funds.json`，页面查询与Python采集共同使用。

## 页面代码

| 位置 | 职责 |
| --- | --- |
| `src/api.ts` | 接口请求、ETag和响应校验 |
| `src/composables/useDashboardData.ts` | 定期检查、切回刷新、错误重试及卸载清理 |
| `src/composables/useDashboard.ts` | 图表选择与时间范围状态，数据刷新时保留交互状态 |
| `src/domain/` | 份额、增减率、均线的类型与计算 |
| `src/components/` | 图表、图例、时间选择器、指标卡片与ETF对比 |
| `src/DashboardPage.vue` | 数据加载状态与页面入口 |
| `src/App.vue` | 图表组合与联动 |

## 数据采集

在根目录执行`python monitor.py`，只采集官方数据并写入SQLite，保存原始响应、修订记录及`data/last_run.json`执行状态。不构建页面、不导出JSON、不生成分析报告、不启动应用。定时任务每天北京时间9:10、23:10执行同一命令，成功静默，执行失败才提示。

`python monitor.py --report`仅供手动生成旧版Markdown报告。`python dashboard.py --snapshot`仅供手动导出某一时刻的聊天快照，这些都不属于定时任务；日常查看数据使用正在运行的本地应用。

## 检查

```powershell
npm test
npm run build
cd ..
python -m unittest discover -s tests -v
```

接口测试使用临时SQLite，验证同日修订立即可查、304版本判断、数据库缺失与错误响应；页面状态测试验证刷新后保留选择与日期范围；采集测试验证默认采集不生成报告或构建页面。均不修改真实数据库或重复联网采集。

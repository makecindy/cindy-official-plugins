const english={
'评分诊断损坏，请恢复诊断文件后重试费用复核；原成绩保留。':'Assessment diagnostics are damaged. Restore the diagnostic file and retry the cost review; the original score is preserved.',
'评测记录损坏，请恢复该记录文件后刷新；原文件保留，未计分。':'Evaluation record is damaged. Restore this record file and refresh; the original file is preserved and not scored.',
'题库清单超过16 MiB，请减少题库元数据后重试；已有题目与材料保留。':'The bank manifest exceeds 16 MiB. Reduce the metadata and retry; existing questions and materials are preserved.',
'请更新 Cindy 以使用页面内授权':'Please update Cindy to authorize access from this page.',
'请更新 Cindy 以使用受管下载':'Please update Cindy to use managed downloads.',
'请更新 Cindy 以使用带并发保护的评测':'Please update Cindy to run evaluations with concurrency protection.',
'请更新 Cindy 开发版以使用题库下载':'Please update Cindy to the matching development build to download question banks.',
'当前 Cindy 不支持普通任务接口，请使用配套开发版。':'This Cindy version does not support the task API. Use the matching development build.',
'任务接口尚未就绪。':'The task API is not ready yet.',
'本地评分中断，请恢复评测以重新评分；已有作答保留，不会重新调用模型。':'Local grading was interrupted. Resume the evaluation to grade the saved answer again without calling the model again.',
'请更新 Cindy 以使用主任务协调评测':'Please update Cindy to run evaluations with a coordinator task.',
'同时作答数必须为正整数':'Concurrent answers must be a positive integer',
"作答目录已有修改或未知文件，保留现场，不自动覆盖。":"The answer directory contains changed or unknown files. They are preserved and will not be overwritten.","评分仍在运行或执行状态未知，已有作答保留，不会重复评分。":"Grading is running or its execution state is unknown. The answer is preserved and grading will not be repeated.","题库发布尚未确认，请重试核对；已有题目与材料保留。":"Bank publication is not confirmed. Retry to verify it; existing questions and materials are preserved.","旧冻结操作状态未知，请先核对原执行；已有题目与材料保留。":"The previous freeze operation has an unknown execution state. Verify the original operation first; existing questions and materials are preserved.",

"重新校准":"Retry calibration","结束本次出题":"End this authoring session","保留材料并结束":"Preserve materials and end","保留旧任务、材料和报告，结束后可以创建新题。仍在运行或状态未知时不会结束。":"Preserve existing tasks, materials and reports so you can create a new question. Running or unknown executions cannot be ended.","出题身份已变化，请刷新后重试。":"Authoring identity changed. Refresh and retry.","出题派发或材料状态未知，请先继续出题核对结果。":"Authoring dispatch or materials are not confirmed. Continue authoring to verify the result first.","请从最新已结束的校准报告发起重试。":"Retry from the latest completed calibration report.","校准尚未结束或执行状态未知，不能结束出题。":"Calibration is running or its execution state is unknown. Authoring cannot be ended.","出题仍在运行或状态未知，不能结束。":"Authoring is running or its execution state is unknown. It cannot be ended.","此出题已结束并保留为历史，请使用新的题目标识或版本。":"This authoring session is preserved as history. Use a new question ID or revision.","校准重试与当前草稿不匹配。":"Calibration retry does not match the current draft.","校准尚未结束或执行状态未知，不能重试。":"Calibration is running or its execution state is unknown. It cannot be retried.","只有已结束且未通过的校准可以重试。":"Only a completed failed calibration can be retried.",

'此目录不支持评测记录所需的硬链接，请改选支持硬链接的本地目录；已有文件保留。':'This directory does not support the hard links required for evaluation records. Choose a local directory that supports hard links. Existing files are preserved.',
'评测目录无法写入，请检查空间、读写权限和连接；已有文件保留。':'Cannot write to the evaluation directory. Check free space, read/write permissions and connectivity. Existing files are preserved.',
'校准材料清理未完成，请检查存储权限和连接；已有文件保留，未重新执行。':'Calibration input cleanup did not finish. Check storage permissions and connectivity. Existing files are preserved; execution has not been repeated.',
'校准材料复制失败，请释放磁盘空间后重试。':'Calibration inputs could not be copied. Free disk space and retry.',
'校准材料复制失败，请检查存储读写权限后重试。':'Calibration inputs could not be copied. Check storage read and write permissions and retry.',
'校准材料复制失败，请检查存储连接和材料是否可读后重试。':'Calibration inputs could not be copied. Check storage connectivity and that the inputs are readable, then retry.',
'评分快照清理未完成，请检查存储权限和连接；已有文件保留，未重新执行。':'Grading snapshot cleanup did not finish. Check storage permissions and connectivity. Existing files are preserved; execution has not been repeated.',
'评分快照复制失败，请释放磁盘空间后重试。':'Grading snapshots could not be copied. Free disk space and retry.',
'评分快照复制失败，请检查存储读写权限后重试。':'Grading snapshots could not be copied. Check storage read and write permissions and retry.',
'评分快照复制失败，请检查存储连接和材料是否可读后重试。':'Grading snapshots could not be copied. Check storage connectivity and that the inputs are readable, then retry.',
'材料包含符号链接，请改用普通文件后重试；已有作答保留。':'The inputs contain symbolic links. Use regular files and retry. Existing answers are preserved.',
'已有未通过的校准报告，请选择该报告明确重试；不会创建并行校准。':'A failed calibration report already exists. Select it to retry explicitly; a parallel calibration will not be created.',
'冻结材料清理未完成，请检查存储权限和连接；已有文件保留，未重新执行。':'Freeze input cleanup did not finish. Check storage permissions and connectivity. Existing files are preserved; execution has not been repeated.',
'冻结材料复制失败，请释放磁盘空间后重试。':'Freeze inputs could not be copied. Free disk space and retry.',
'冻结材料复制失败，请检查存储读写权限后重试。':'Freeze inputs could not be copied. Check storage read and write permissions and retry.',
'冻结材料复制失败，请检查存储连接和材料是否可读后重试。':'Freeze inputs could not be copied. Check storage connectivity and that the inputs are readable, then retry.',
'作答准备清理未完成，请检查存储权限和连接；已有文件保留，未重新执行。':'Answer preparation cleanup did not finish. Check storage permissions and connectivity. Existing files are preserved; execution has not been repeated.',
'作答准备复制失败，请释放磁盘空间后重试。':'Answer preparations could not be copied. Free disk space and retry.',
'作答准备复制失败，请检查存储读写权限后重试。':'Answer preparations could not be copied. Check storage read and write permissions and retry.',
'作答准备复制失败，请检查存储连接和材料是否可读后重试。':'Answer preparations could not be copied. Check storage connectivity and that the inputs are readable, then retry.',
'单批最多 200 份作答，请分批运行':'A batch supports up to 200 answers. Split your selection into smaller batches.',
'来源':'Source',
'下载已取消':'Download cancelled',
'未关联题库':'Unlinked bank',
'题库已不在当前目录；旧成绩按原来源单独保留，请选择题目版本查看，不与新题库合并。':'This bank is no longer in the current catalog. Its results remain separate under their original source. Choose a question version to view; results are not merged into a new bank.',
'Cindy 实战题库':'Cindy Practical Evaluation Bank',
'草稿材料缺失或不完整，请重新选择材料创建题目；原文件保留，尚未派发出题任务。':'Draft materials are missing or incomplete. Select materials to create a new question. Original files are preserved; no authoring task has been dispatched.',
'校准未通过，请检查校准报告并修正草稿后重试。':'Calibration failed. Check its report, correct the draft and retry.',
'此题库需要 Apple 芯片的 macOS，请在支持的设备上安装和运行，或导入兼容当前平台的题库。':'This bank requires macOS on Apple silicon. Install and run it on a supported device, or import a bank compatible with this platform.',
'正在自动恢复':'Recovering automatically','等待主任务确认':'Waiting for coordinator confirmation','正在停止评测':'Stopping evaluation','主任务正在协调':'Coordinator is organizing the evaluation','等待授权':'Waiting for permission','正在准备作答目录':'Preparing answer directories','等待模型开始':'Waiting for the model to start','模型正在作答':'Model is answering','正在独立评分':'Grading independently','正在核对执行状态':'Checking execution status','评测暂停，需要处理':'Evaluation paused; action required',

'Python 3 无法运行，请安装 Python 3 并确保 Cindy 的 PATH 能找到 python3，重启 Cindy 后重试；已有作答和成绩保留。':'Python 3 cannot run. Install Python 3, make python3 available in Cindy’s PATH, restart Cindy and retry. Existing answers and scores are preserved.',
'并发上限':'Concurrency limit','协调费用 USD':'Coordinator cost USD','约':'Approx.','单列，不计入模型作答费用':'Listed separately; excluded from model answer costs',
'出题尚未结束，请完成出题和校准后再更改数据目录。':'Authoring is still in progress. Finish authoring and calibration before changing the data directory.',
'评测尚未结束，请完成或停止评测后再更改数据目录。':'An evaluation is still in progress. Complete or stop it before changing the data directory.',
'Python 3 无法运行，请安装 Python 3 并确保 Cindy 的 PATH 能找到 python3，重启 Cindy 后重试；尚未开始模型作答。':'Python 3 cannot run. Install Python 3, make python3 available in Cindy’s PATH, restart Cindy and retry. Model answering has not started.',
'评测主任务目录不可用，请检查任务目录后重试；已有作答保留。':'The evaluation coordinator directory is unavailable. Check its task directory and retry; existing answers are preserved.',
'按最近核验的题库版本显示；开始评测时检查在线更新。':'Showing the last verified bank version; starting an evaluation checks online updates.',
'下载内容校验失败，请重新获取题库；仍失败请联系维护者。':'Downloaded content could not be verified. Fetch the bank again or contact its maintainer.',
'题库解包超时，请检查磁盘负载或改用更快的存储后重试；已有题库和成绩保留。':'Bank extraction timed out. Check disk load or use faster storage and retry. Existing banks and results are preserved.',
'题库安装未完成，请重试；仍失败请联系题库维护者。':'Bank installation did not finish. Retry or contact its maintainer.',
'已安装题库校验失败，请在高级设置中重新导入可信题库或联系维护者；已有成绩保留。':'Installed bank verification failed. Import a trusted bank in Advanced settings or contact its maintainer; existing results are preserved.',
'题包校验或解压失败，请重新下载；仍失败请联系题库维护者。':'Bank verification or extraction failed. Download it again or contact its maintainer.',
'题库无法写入，请检查可用磁盘空间和插件存储权限后重试。':'Cannot write the bank. Check free disk space and plugin storage permissions before retrying.',

'继续出题':'Continue authoring',
'题库连接失败，请检查网络、DNS 或代理设置后重试；已有离线题库仍可使用。':'Bank connection failed. Check your network, DNS or proxy settings and retry; installed offline banks remain available.',
'题库安全连接验证失败，请检查系统时间和代理证书，或联系题库维护者；不要关闭证书校验。':'Bank secure connection verification failed. Check your system clock and proxy certificates, or contact the bank maintainer; do not disable certificate verification.',
'出题请求未被受理，请检查任务配置和插件权限后重新创建。':'The authoring request was not accepted. Check the task configuration and plugin permissions before creating it again.',
'出题未完成，请查看出题任务并检查草稿；已有成绩保留。':'Authoring did not finish. Open the authoring task and check its draft; existing scores are preserved.',
'题库索引损坏或不兼容，请检查发布源并重新获取；仍失败请联系题库维护者。':'The bank index is damaged or incompatible. Check the release source and fetch it again; contact the bank maintainer if it still fails.',
'导入题库不可用，请重新连接存储设备或在高级设置中重新导入。':'Imported bank unavailable. Reconnect its storage or import it again in Advanced settings.',
'题库版本无法核对，请检查网络后重试；不会自动选择其他缓存版本。':'Cannot verify the bank version. Check the network and try again; no other cached version will be selected.',
'所选题库版本不可用，请重新选择题库。':'The selected bank version is unavailable. Select the bank again.',
'下载的题目不可用，请检查题库后重试。':'The downloaded question is unavailable. Check the bank before trying again.',
'已有出题任务正在启动，请等待完成。':'A question-authoring task is starting. Wait for it to finish.',
'已有出题任务尚未结束，请等待完成后再创建。':'A question-authoring task is still active. Wait for it to finish before creating another.',
'GitHub 限制了公开附件下载，请稍后重试或检查网络访问限制；插件不需要 GitHub Token。':'GitHub restricted the public download. Try later or check network restrictions; this plugin does not need a GitHub token.',
'找不到公开题库附件，请检查题库发布源或联系题库维护者确认 Release 仍可用。':'Public bank attachment not found. Check the source or ask its maintainer whether the release is still available.',
'GitHub 下载服务暂时不可用，请稍后重试；已有离线题库仍可使用。':'GitHub downloads are temporarily unavailable. Try later; existing offline banks remain usable.',
'GitHub 未能提供题库附件，请检查公开 Release 地址与网络连接。':'GitHub could not provide the bank attachment. Check the public release URL and network connection.',
'正在自动恢复':'Recovering automatically',
'恢复评测':'Resume evaluation',
'停止准备':'Stop preparation','已收到停止请求。':'Stop requested.','已停止准备。':'Preparation stopped.',
'无法核对现行题库版本；可在高级筛选中查看已安装版本，版本之间不混算。':'Cannot verify the current bank version. View installed versions in advanced filters; versions are scored separately.',
'出题草稿已保存。请在插件详情允许修改文件后继续出题。':'Your authoring draft is saved. Allow file changes in plugin details, then continue authoring.',
'模型成绩':'Model results','选一个题库，看看谁更适合你的工作。':'Choose a bank to compare your models.','最新成绩':'Latest results','历次平均':'Average results','成绩统计方式':'Scoring view','高级筛选':'Advanced filters','题目与版本':'Question and version','测试批次':'Evaluation batch','全部现行题目':'All current questions','全部测试':'All evaluations','历史版本':'Historical version','旧版题目单独查看，不与现行题库混算。':'Historical versions are shown separately.','分享成绩':'Share results','分享当前榜单，自动汇总有效成绩；不附聊天、源码与本机路径。':'Share this leaderboard without chats, source code or local paths.','每题取最近一次有效成绩，补测自动合并。':'Latest valid result per question; retests fill missing results.','每题先取有效作答平均分，再合计；重复测试不增加题目权重。':'Average each question before summing; repeated tests do not increase its weight.','已测齐':'Complete','已得分':'Points earned','已测':'Completed','待补测':'Not yet graded','最近一次环境受阻':'Latest attempt was blocked','已计入':'Included','尚无此版本的有效成绩':'No valid results for this version','这个题库还没有成绩。开始评测后，模型总成绩会显示在这里。':'No results for this bank yet. Run an evaluation to see model scores.','未知费用不记零；完整成绩与未测齐成绩分开排序。':'Unknown costs are not zero; incomplete results rank separately.','费用 USD':'Cost USD','时间未知':'Date unknown','排队':'Queue','评分':'Grading',

'同时作答数':'Concurrent answers','环境受阻，不计分':'Environment blocked — unscored','环境受阻':'Environment blocked','等待审批':'Awaiting approval','队列暂停':'Queue paused','模型正在执行':'Model executing','等待可用 Worker 槽位':'Waiting for a Worker slot','等待主任务派发':'Awaiting coordinator dispatch',

'评测进度':'Evaluation progress','本次评测':'This evaluation','进度自动更新':'Progress updates automatically','连接暂时中断，正在自动重连；已有进度保留。':'Connection interrupted. Reconnecting automatically; existing progress is preserved.','查看成绩':'View results','再测一轮':'Run another evaluation','成绩已保存，可随时查看与分享。':'Results are saved and ready to view or share.','各份作答进度':'Submission progress','评测完成进度':'Evaluation completion','已评分':'Graded','已停止':'Stopped','需要处理':'Needs attention','正在作答':'Answering','等待开始':'Waiting','等待评分':'Awaiting grading','正在评分':'Grading','评测已结束':'Evaluation finished',

"正在准备…":"Preparing…","请先选择模型和思考强度。":"Select a model and reasoning effort first.","请为已选模型选择至少一个强度。":"Choose at least one effort for each selected model.","正在检查题库与模型配置…":"Checking questions and model configuration…","评测批次已创建，正在准备任务。":"Batch created. Preparing tasks.",
"模型已隐藏，可展开查看。":"Models are hidden. Expand to view them.",
"展开隐藏模型":"Show hidden models","收起隐藏模型":"Collapse hidden models",
"找到适合你工作的模型。":"Find the right model for your work.","跑评测":"Evaluate","看成绩":"Results","自己出题":"Create questions","让模型做一次真实工作":"Put a model to work","七道项目题，自主查错，独立验收。":"Seven real project tasks. Independent discovery and grading.","测试哪个模型":"Model to evaluate","跟随 Cindy 当前模型；也可输入 Luna high 等配置":"Use your Cindy model, or enter a configuration such as Luna high","留空即可沿用当前选择，使用已有账号。":"Leave blank to use the current selection and connected account.","已选 7 道题":"7 questions selected","已选题目":"Selected","调整题目":"Customize","开始评测":"Start evaluation","题库按需准备，结果自动保存。运行会产生所选模型的费用。":"Questions are prepared as needed. Results are saved automatically. Your selected model account is billed for usage.","查看协调状态":"Coordinator details","读取状态":"Check status","协调任务首轮结束不代表全部评测结束，成绩以各题验收为准。若 Cindy 尚未授予执行权限，请在插件详情的「AI 代办」中设置；插件不会自行提权。":"The coordinator\u2019s first turn is not the completion of the entire evaluation. Each question is graded separately. If execution permission is missing, configure it in the plugin\u2019s AI errand settings. Permissions are never raised automatically.","你的模型成绩":"Your model results","每题 1 分，按考核点完成度计分。":"One point per question, based on completed assessment criteria.","还没有成绩。先让模型做一次真实工作。":"No results yet. Put a model to work first.","分享":"Share","得分":"Score","导出成绩网页":"Export results webpage","单个 HTML 文件即可分享，不附聊天、源码和本机路径。":"Share one HTML file, without chat history, source code or local paths.","用自己的工作出题":"Create from your own work","粘贴一次真实需求或排查过程，我们整理成可复现、可评分的题目。":"Paste a real requirement or investigation to turn it into a reproducible, gradable question.","选定的任务记录":"Selected task excerpts","产品需求、遇到的问题、排查过程与结果……请先移除凭证和个人信息。":"Requirements, problems, investigation and outcomes. Remove credentials and personal information first.","补充来源与版本":"Source and version","来源任务链接（可选）":"Source task link (optional)","题目标识（自动生成）":"Question ID (automatic)","生成评测题":"Create question","仅使用选定材料，不扫描全部历史。生成后先验证，再由你加入题库。":"Only selected material is used. After validation, you choose whether to add the question.","待加入的题目":"Ready to add","已校准草稿":"Calibrated drafts","加入我的题库":"Add to my questions","高级设置":"Advanced settings","更换保存位置":"Change storage location","导入离线题库":"Import offline bank","更换位置不搬移或删除旧数据。默认题库支持 macOS Apple Silicon，需要 Python 3。":"Changing location does not move or delete existing data. Default questions require macOS Apple Silicon and Python 3.","题库发布源":"Question source","检查题库":"Check source","提前下载所选题目":"Download ahead of time","只接受 makecindy 的公开 GitHub Release。旧版本保留，正在进行的评测不随更新改变。":"Only public makecindy GitHub Releases are accepted. Existing versions and ongoing evaluations are preserved.","资料保存在插件默认位置，无需选择目录。":"Data is stored automatically. No folder selection needed.","正在使用你选择的保存位置。":"Using your selected storage location.","待交卷":"Awaiting submission","未能评分":"Not graded","已验收":"Graded","评测已启动，成绩会自动出现在这里。":"Evaluation started. Results will appear here automatically.","正在整理题目，完成后会出现在待加入列表。":"Preparing your question. It will appear in the ready-to-add list.","正在准备默认题库…":"Preparing default questions\u2026","题库已就绪，正在启动评测…":"Questions ready. Starting evaluation\u2026",

'GitHub Release 题库索引地址':'GitHub Release bank index URL','查看在线题库':'Browse online bank','下载所选题目':'Download selected questions',
'仅从 makecindy 的公开 Release 获取。选择题目后才下载运行环境，校验后保存在本地；不会启动模型。已下载版本继续可用。':'Downloads come from public makecindy Releases only. Runtimes are downloaded after you select questions, verified and cached locally. No model is started. Existing versions remain available.',
'选择要下载的题目。':'Select questions to download.','题库已下载并校验，可离线运行。':'Questions downloaded and verified. Ready for offline use.',

'评测工坊':'Evaluation Lab','用真实项目检查模型能力，也为自己的工作建立题库。':'Evaluate models on real projects and build a question bank for your own work.',
'题库与评测':'Questions & runs','从任务出题':'Create questions','成绩与分享':'Results & sharing','本地资料':'Local storage',
'默认离线题包支持 macOS Apple Silicon，独立评分需要 Python 3。选择目录不会启动模型。':'The default offline bank requires macOS Apple Silicon and Python 3. Selecting folders does not start a model.',
'选择评测保存目录':'Choose data folder','选择已解压的题包':'Choose extracted bank','刷新':'Refresh','选择题目':'Select questions',
'每题 1 分。更新版本分别计分，评分器与被测工作目录分开。':'Each question is worth one point. Versions are scored separately; graders stay outside the answering workspace.',
'要测试的模型、强度和来源':'Model, reasoning effort and account source','例如：GPT-6 Luna high，使用我的 OpenAI 账号':'For example: GPT-6 Luna high, using my OpenAI account',
'协调 Agent 会先核对实际配置，再为每题创建独立 Orca Worker。模型产生的费用由所选账号结算。':'The coordinator verifies the actual configuration and creates an independent Orca Worker for each question. Model usage is billed to your selected account.',
'运行所选评测':'Run selected questions','协调 Agent 的模型与写文件权限在插件详情的「AI 代办」设置中选择。':'Configure the coordinator model and file permissions in this plugin’s AI errand settings.',
'查看协调首轮状态':'Check coordinator turn','从自己的任务记录出题':'Create questions from your task records',
'只分析你选定的记录。可在聊天中引用任务并让评测工坊出题，也可在这里粘贴片段；插件不会扫描全部历史。':'Only selected records are used. Reference tasks in chat or paste excerpts here. The plugin does not scan all history.',
'来源任务标识':'Source task identifier','任务链接或标识':'Task link or identifier','选定的记录':'Selected excerpts',
'粘贴产品需求、反复排查过程及结果；提交前移除凭证和个人信息。':'Paste requirements, investigation and outcomes. Remove credentials and personal information before submitting.',
'题目标识':'Question ID','版本':'Version','创建并校准草稿':'Create and calibrate draft',
'Agent 会整理产品约定、候选项目、参考实现和独立评分器；材料不足时保留草稿，不伪造题目。':'The author prepares the product contract, candidate project, reference implementation and independent grader. Insufficient material stays a draft.',
'加入本地题库':'Add to local bank','校准完成的草稿':'Calibrated draft','完成出题后点刷新':'Refresh after authoring completes','冻结为新版本':'Freeze new version',
'勾选要分享的结果。报告不包含聊天原文、源码和本机路径；费用缺失显示未知。':'Select results to share. Reports exclude raw chats, source code and local paths. Missing costs remain unknown.',
'选择':'Select','题目':'Question','模型':'Model','状态 / 得分':'Status / score','导出单文件网页':'Export single-file webpage',
'处理中…':'Working…','已刷新。':'Refreshed.','网页已导出。':'Webpage exported.','保存目录已选择。':'Data folder selected.','题库已载入。':'Question bank loaded.',
'协调任务已受理，运行结果会写入本地成绩。':'Coordinator accepted the request. Results will be saved locally.',
'已读取任务状态。':'Task status retrieved.','出题任务已受理。完成后在这里冻结通过校准的版本。':'Authoring accepted. Return here to freeze the calibrated version.',
'新版本已加入本地题库。':'New version added to the local bank.','已取消另存，报告仍保留在本地作品库。':'Save cancelled. The report remains in the local library.'};
Object.assign(english,{"用真实工作，找到适合自己的模型。": "Find the right model through real work.", "开始评测": "Evaluate", "历史成绩": "History", "题库": "Question bank", "导入题库": "Import bank", "选择题库": "Choose question bank", "查看题目 ↗": "View questions ↗", "全选": "Select all", "清空": "Clear", "全强度": "All efforts", "读取我的模型": "Load my models", "先读取已连接的模型，随后即可多选。": "Load connected models to select configurations.", "通过 Cindy 核验已有账号与可用强度，不读取凭证。读取过程会启动一个协调任务。": "Cindy checks connected accounts and efforts without reading credentials. Loading starts a coordinator task.", "目录已读取，运行前仍会核验实际账号与强度。": "Catalog loaded. Accounts and efforts are checked again before evaluation.", "批量设置思考强度": "Set efforts in bulk", "保持各自选择": "Keep individual selections", "所有可用强度": "All available efforts", "每个模型可以选择多个强度，分别计分。": "Select multiple efforts per model, scored separately.", "不支持该强度，保留原选择。": "Effort unavailable; previous selection retained.", "道题": "questions", "组模型配置": "configurations", "次作答": "answers", "自主查错，独立验收": "Independent bug hunt and grading", "开始测试": "Start evaluation", "自动准备题库并保存成绩，按所选账号的实际用量计费。": "Questions and results are managed automatically. Usage is billed to selected accounts.", "每一次测试，都有记录": "Your evaluation history", "按题目与版本查看，只有独立验收后才显示成绩。": "Grouped by question and version. Scores appear only after independent grading.", "导出所选成绩": "Export selected results", "单文件网页，不附聊天、源码与本机路径。费用统一为美元，缺失显示未知。": "One webpage without chats, code or local paths. Costs in USD; missing costs remain unknown.", "全部题目": "All questions", "相同题目版本与评分内容": "Same version and grading content", "份记录": "records", "未知": "Unknown", "详情": "Details", "耗时": "Duration", "创建自己的题库": "Create my question bank", "从你做过的工作里，提取值得考模型的问题。": "Create questions from your own work.", "题库名称": "Bank name", "例如：我的前端开发日常": "For example: My frontend work", "粘贴或引用需求、排查过程、反复修改的片段……": "Paste selected requirements, investigations or revisions…", "只使用你选定的内容。先生成草稿、校准评分，再由你加入题库。请先移除凭证与个人信息。": "Only selected material is used. Draft and calibrate first, then add it to your bank. Remove credentials and personal information.", "生成并校准题目": "Create and calibrate", "取消": "Cancel", "完成": "Done", "校准未通过": "Calibration failed", "正在读取模型，完成后列表会自动更新。": "Loading models. The list updates automatically.", "协调任务结束不代表整批完成，成绩以各题独立验收为准。": "Coordinator completion is not batch completion. Each question must be independently graded."});
Object.assign(english,{
 '出题材料交接未完成，请检查任务目录与题包内容后重试；原始草稿保留。':'Authoring handoff did not finish. Check the task folder and question content, then retry; the original draft is retained.',
 '出题任务尚未完成，暂不能导回或校准。':'The authoring task is not complete. Import and calibration are not available yet.',
 '已安装题库损坏，请重新运行默认题库以下载修复；已有成绩保留。':'An installed bank is damaged. Run the default bank again to repair it; saved scores are retained.',
 '题库正在安装，请等待当前操作完成后重试。':'The bank is being installed. Wait for the current operation before retrying.',
 '本批已结束，未准备的作答未运行、未计分。修复准备错误后可对遗漏题目开始新评测；已有成绩保留。':'This batch has ended. Unprepared answers were not run or scored. Fix the preparation error and start a new evaluation for omitted questions; saved scores are retained.',
 '旧批次的计划已冻结，无法补入未准备的作答。请先停止本批，再为遗漏题目开始新评测；已有成绩保留。':'This older batch has a frozen partial plan. Stop it and start a new evaluation for the omitted questions; saved scores are retained.',
 '校准准备尚未确认，请稍后重试；不要重复执行评分。':'Calibration preparation is not confirmed. Retry later; do not repeat an unknown grading attempt.',
 '同一草稿存在多个校准记录，请先核对原执行状态；不会重复执行评分。':'Multiple calibration records match this draft. Check their execution state first; grading will not be repeated.'
});


Object.assign(english,{"正在读取已连接的模型…": "Loading connected models…", "暂无可用模型，请先在 Cindy 中连接模型来源。": "No models available. Connect a model provider in Cindy.", "已显示当前已连接的模型和强度，读取不产生模型费用。": "Connected models and efforts. Loading the catalog does not use model tokens.", "当前 Cindy 版本不支持模型目录，请升级后重试。": "This Cindy version does not support the model catalog. Please update.", "模型目录暂时不可用，请刷新重试。": "Model catalog unavailable. Please refresh to retry."});

Object.assign(english,{"刷新进度":"Refresh progress","停止评测":"Stop evaluation","正在评测":"Evaluating","已结束":"Finished","已停止":"Stopped","逐份运行并独立评分。离开页面后当前任务继续执行，返回页面后继续下一份。":"Runs are graded individually. The active task continues when you leave; return to advance the next run."});

Object.assign(english,{
 "等待中": "Waiting",
 "时间未知": "Time unknown",
 "评测进行中": "Evaluation in progress",
 "题目准备中": "Preparing question",
 "环境未满足要求，详细诊断保留在本地。": "Environment requirements were not met. Detailed diagnostics remain local.",
 "本次未完成，详细诊断保留在本地。": "This run did not finish. Detailed diagnostics remain local.",
 "同一作答出现多个 Worker，需主任务核对，不自动计分": "Multiple Workers match one answer. The coordinator must check; no score is assigned automatically.",
 "Worker 实际配置或目录不匹配，未计分": "Worker configuration or directory does not match; unscored.",
 "Worker 异常结束，保留作答，未计分": "Worker ended unexpectedly. The answer is preserved and unscored.",
 "等待自动审批或用户确认": "Waiting for automatic review or user confirmation",
 "队列已暂停": "Queue paused",
 "宿主排队中": "Queued by host",
 "等待终态核对": "Waiting for final status verification",
 "主任务的工具授权未完成或已拒绝，自动催办已暂停。请打开评测主任务处理授权，再继续协调；已有成绩保留。": "Coordinator tool permission is pending or denied. Automatic follow-up is paused. Open the coordinator task to handle permission, then continue; saved results are retained.",
 "派发尚未确认，已暂停自动催办；现有作答保留。": "Dispatch is not confirmed. Automatic follow-up is paused; existing answers are preserved.",
 "本批已结束；环境受阻的作答不计入正式总分。": "This batch has ended. Environment-blocked answers are excluded from the official total.",
 "部分作答受阻，已有成绩已保存。": "Some answers are blocked. Existing results are saved.",
 "主任务按调度清单并行派发，交卷后独立评分并释放槽位。": "The coordinator dispatches answers in parallel from the plan. Submitted answers are graded independently and release their slots.",
 "进度读取暂时冲突，正在自动恢复；已有作答和成绩保留。": "Progress retrieval conflicted. Recovering automatically; existing answers and results are preserved.",
 "等待任务停止回执；已完成成绩保留。": "Waiting for task stop confirmation; completed results are preserved.",
 "评测已停止，已完成成绩保留。": "Evaluation stopped; completed results are preserved.",
 "已停止准备，没有派发新的作答。": "Preparation stopped. No new answers were dispatched.",
 "正在停止评测，已完成的作答和成绩保留。": "Stopping evaluation; completed answers and results are preserved.",
 "已停止派发，已交卷作答的评分尚未完成；文件保留，请处理评分错误后重试。": "Dispatch stopped. Submitted answers still need grading. Files are preserved; address the grading error and retry.",
 "等待主任务停止回执；未确认前不会开始新批次。": "Waiting for coordinator stop confirmation. A new batch cannot start until confirmed.",
 "正在自动恢复进度核对，已有作答和成绩保留。": "Recovering progress verification automatically; existing answers and results are preserved.",
 "需要允许 AI 修改作答文件。确认后继续这一批，无需重新开始。": "Allow AI to modify answer files. After confirmation, continue this batch without restarting.",
 "任务结束但未完成交卷，未计分": "Task ended without submission; unscored.",
 "宿主正在核对执行结果；不会重复发送，也不会计为零分。": "The host is verifying execution. The request will not be repeated or scored as zero.",
 "作答准备失败：": "Answer preparation failed: ",
 "评分受阻：": "Grading blocked: ",
 "诊断复核暂未完成：": "Diagnostic verification is incomplete: ",
 "{count} 份同时作答": "{count} concurrent answers",
 "未生成总分（缺题、无效结果或重复样本）": "No total (missing questions, invalid results or duplicate samples)",
 "宿主估算": "Host estimate",
 "评测成绩": "Evaluation results",
 "模型 / 框架 / 强度": "Model / Harness / Effort",
 "每题 1 分，按冻结考核点完成度计分。不同版本分开比较；未知费用不记为零。作答耗时按宿主首个模型活动至终态的观测区间统计，不代表纯计算时间。结果来自本地评测，非第三方认证。": "Each question is worth one point, based on frozen assessment criteria. Versions are compared separately; unknown costs are not zero. Answer duration is the host-observed interval from first model activity to completion, not pure compute time. Results are local evaluations, not third-party certification.",
 "报告不包含原始任务记录、源码、文件路径或账号标识。": "Reports exclude raw task records, source code, file paths and account identifiers.",
 "每题 1 分": "One point per question",
 "每题先取有效作答平均分，再合计。": "Valid answers are averaged per question, then summed.",
 "环境失败不计分；不同题目版本不混算。未测齐的配置单独排列。": "Environment failures are unscored. Question versions are kept separate. Incomplete configurations rank separately.",
 "模型 / 强度": "Model / Effort",
 "总成绩": "Total score",
 "已测题数": "Questions graded",
 "已得分 · 待补测": "Points earned · Incomplete",
 "各题成绩": "Results per question",
 "（最近一次环境受阻）": " (latest attempt blocked)",
 "费用为纳入统计作答的累计已知美元金额；任一费用缺失则显示未知，不记零。结果来自本地评测，非第三方认证。报告不包含聊天、源码、文件路径或账号凭证。": "Costs sum the included answers in USD. If any cost is missing, the total is unknown, not zero. Results are local evaluations, not third-party certification. Reports exclude chats, source code, file paths and account credentials."
});
Object.assign(english,{
 "启用 Auto 自动审批后，主任务和 Worker 将按此权限继续评测。": "After Auto approval is enabled, the coordinator and Workers will continue with that permission.",
 "评测主任务正在等待你的确认。请在侧栏打开评测主任务处理确认；插件不会代替你批准或自动催办。": "The coordinator is waiting for your confirmation. Open it in the sidebar; this plugin will not approve or follow up automatically.",
 "已收到停止请求，正在结束当前操作；不再准备后续题目。": "Stop requested. Finishing the current operation; no further questions will be prepared.",
 "协同模式尚未就绪": "Team mode is not ready yet",
 "没有可开始的作答，请检查题包准备错误": "No answers are ready to start. Check the question preparation errors.",
 "无法核对协同状态": "Unable to verify the team state",
 "模型目录已变化，请重新读取并选择": "The model catalog has changed. Reload it and select a model again.",
 "至少选择一道题": "Select at least one question",
 "请选择模型和强度": "Select a model and reasoning effort",
 "无法核对主任务执行回执": "Unable to verify the coordinator execution receipt",
 "主任务回执分页未完成": "Coordinator receipt pagination is incomplete",
 "执行回执与任务不匹配": "The execution receipt does not match the task",
 "实际执行配置与所选模型不一致，未计分": "The actual execution configuration differs from the selected model. This answer was not scored.",
 "完成回执缺少执行身份，暂不评分": "The completion receipt lacks execution identity. Grading is on hold.",
 "宿主未返回独立作答目录": "Cindy did not return an isolated answer directory",
 "题库正在准备，请稍候": "The question bank is being prepared. Please wait.",
 "评测批次已变化": "The evaluation batch has changed",
 "评测正在准备，完成后可更改设置": "Evaluation is being prepared. Settings can be changed when preparation finishes.",
 "评测正在准备，请勿重复启动": "Evaluation is being prepared. Do not start it again.",
 "已有评测正在运行，请先等待或停止。": "An evaluation is already running. Wait for it to finish or stop it first.",
 "当前批次已变化，请刷新": "The current batch has changed. Refresh to continue.",
 "读取身份校验失败(目标 identity 不一致)": "Read identity verification failed (target identity mismatch)",
 "停止未完成：": "Stop incomplete: ",
 "正在下载并校验：": "Downloading and verifying: ",
 "题库已就绪，正在创建独立任务…": "The question bank is ready. Creating an isolated task…",
 "题库下载重定向无效或不受支持，请联系题库维护者检查发布源。": "The question download redirect is invalid or unsupported. Ask the question bank maintainer to check the release source.",
 "私人题库": "Private question bank",
 "私人题库清单损坏，请恢复题库清单或联系维护者；已有题目和成绩保留。": "The private question bank manifest is damaged. Restore the manifest or contact the maintainer. Existing questions and scores are preserved.",
 "执行归属校验失败(目标 identity 不一致)": "Execution ownership verification failed (target identity mismatch)",
 "正在准备题目": "Preparing question",
 "正在准备评测": "Preparing evaluation",
 "已停止评测": "Evaluation stopped",
 "音频重采样": "Audio resampling",
 "灵动岛交互": "Island interaction",
 "自动恢复": "Automatic recovery",
 "输入框发送": "Composer submission",
 "手机消息顺序": "Mobile message ordering",
 "远程文件": "Remote files",
 "消息缓存": "Message cache"
});
Object.assign(english,{'启用 Auto 并继续':'Enable Auto and continue','允许修改并继续':'Allow file changes and continue'});
Object.assign(english,{
 '请检查 Python 执行权限。':'Check Python execution permissions.',
 '请关闭不需要的程序，释放系统资源后重试。':'Close unused programs to free system resources, then retry.',
 '请检查 Python 程序和系统资源后重试。':'Check the Python executable and system resources, then retry.',
 '正在确认 Worker 槽位释放，已有成绩已保存。':'Waiting for Worker slot release confirmation. Existing scores are saved.'
});
function translate(locale,text,params={}){
 if(typeof text!=='string')return text;
 let result=text;
 if(locale!=='zh-CN'){
  result=english[text]||text;
  const startup=text.match(/^Python 无法启动（([^）]+)）。(.*)已有作答和成绩保留。$/);
  if(startup)result=`Python could not start (${startup[1]}). ${english[startup[2]]||startup[2]} Existing answers and results are preserved.`;
  if(result===text)for(const prefix of ['作答准备失败：','评分受阻：','诊断复核暂未完成：','停止未完成：','正在下载并校验：'])if(text.startsWith(prefix)){result=english[prefix]+translate(locale,text.slice(prefix.length));break;}
 }
 return result.replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(params,key)?String(params[key]):match);
}
Object.assign(english,{'评测页面':'Evaluation pages','题库下载进度':'Question bank download progress','筛选历史题库':'Filter historical question banks','关闭':'Close','自动：使用全部可用 Worker 槽位':'Automatic: use all available Worker slots'});
const runStatusLabels={prepared:'待交卷',failed:'未能评分',cancelled:'已停止',environment_invalid:'环境受阻，不计分'};
function runStatus(locale,status){return translate(locale,Object.hasOwn(runStatusLabels,status)?runStatusLabels[status]:'未知');}
if(typeof module==='object')module.exports={translate,runStatus};
if(typeof window!=='undefined'){
 // Match the source HTML until Host locale resolves; rejection still selects English.
 let uiLocale='zh-CN';window.evalLocale=uiLocale;window.evalTranslate=(text,params)=>translate(uiLocale,text,params);window.evalRunStatus=status=>runStatus(uiLocale,status);
 window.evalLocaleReady=(async()=>{try{const r=await(await fetch('/app-context')).json();uiLocale=r.context?.locale==='zh-CN'?'zh-CN':'en';}catch{uiLocale='en';}window.evalLocale=uiLocale;if(uiLocale==='zh-CN')return;document.documentElement.lang='en';const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walk.nextNode()){const n=walk.currentNode;if(['SCRIPT','STYLE'].includes(n.parentElement?.tagName))continue;const t=n.textContent.trim();if(english[t])n.textContent=n.textContent.replace(t,english[t]);}for(const attr of ['placeholder','aria-label','aria-description','title','alt'])for(const e of document.querySelectorAll('['+attr+']'))e.setAttribute(attr,window.evalTranslate(e.getAttribute(attr)));})();
}

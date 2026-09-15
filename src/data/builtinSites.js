// 内置导航目录：开箱即用的常用站点，用户在「内置导航」弹窗中一键添加到自己的网格。
// - icon 走 iowen favicon 服务（国内可达、按域名缓存站点图标）；卡片/网格端 referrerPolicy=no-referrer
// - 「受欢迎的」分类刻意与细分分类重复收录（与目录型产品的首页精选一致）；
//   去重由 BuiltinModal 按URL 判定（已添加的站点按钮置灰），测试按 (cat+url) 唯一校验
// - group = 添加进网格时的分组名

const ico = (d) => `https://api.iowen.cn/favicon/${d}.png`

export const BUILTIN_CATEGORIES = [
  { key: 'popular', name: '受欢迎的', group: '常用' },
  { key: 'app', name: '实用应用', group: '实用应用' },
  { key: 'news', name: '新闻资讯', group: '新闻资讯' },
  { key: 'video', name: '影音视频', group: '影音视频' },
  { key: 'image', name: '图片设计', group: '图片设计' },
  { key: 'shop', name: '购物与团购', group: '购物' },
  { key: 'social', name: '社交与博客', group: '社交' },
  { key: 'travel', name: '体育与旅行', group: '体育旅行' },
  { key: 'life', name: '生活方式', group: '生活' },
  { key: 'game', name: '游戏与娱乐', group: '游戏' },
  { key: 'edu', name: '教育与招聘', group: '教育求职' },
  { key: 'tech', name: '数码科技', group: '数码科技' },
  { key: 'finance', name: '金融理财', group: '金融' },
  { key: 'read', name: '阅读小说', group: '阅读' },
  { key: 'dev', name: '开发工具', group: '开发' },
]

export const BUILTIN_SITES = [
  // ---- 受欢迎的（精选） ----
  { cat: 'popular', name: '京东商城', url: 'https://www.jd.com', desc: '专业的综合网上购物商城，家电数码正品低价', icon: ico('jd.com') },
  { cat: 'popular', name: '淘宝网', url: 'https://www.taobao.com', desc: '亚洲较大的网上交易平台，淘！我喜欢', icon: ico('taobao.com') },
  { cat: 'popular', name: '哔哩哔哩', url: 'https://www.bilibili.com', desc: '国内知名的视频弹幕网站，创作者聚集地', icon: ico('bilibili.com') },
  { cat: 'popular', name: '知乎', url: 'https://www.zhihu.com', desc: '中文互联网高质量的问答社区', icon: ico('zhihu.com') },
  { cat: 'popular', name: '微博', url: 'https://weibo.com', desc: '随时随地发现新鲜事', icon: ico('weibo.com') },
  { cat: 'popular', name: '小红书', url: 'https://www.xiaohongshu.com', desc: '你的生活指南，标记我的生活', icon: ico('xiaohongshu.com') },
  { cat: 'popular', name: '豆瓣', url: 'https://www.douban.com', desc: '书影音社区，记录你的文化生活', icon: ico('douban.com') },
  { cat: 'popular', name: '网易云音乐', url: 'https://music.163.com', desc: '音乐的力量，听见好时光', icon: ico('music.163.com') },
  { cat: 'popular', name: '抖音', url: 'https://www.douyin.com', desc: '记录美好生活', icon: ico('douyin.com') },
  { cat: 'popular', name: '什么值得买', url: 'https://www.smzdm.com', desc: '值得买的消费门户，网购省钱利器', icon: ico('smzdm.com') },
  { cat: 'popular', name: '携程旅行', url: 'https://www.ctrip.com', desc: '酒店机票火车票一站式预订', icon: ico('ctrip.com') },
  { cat: 'popular', name: '百度', url: 'https://www.baidu.com', desc: '全球领先的中文搜索引擎', icon: ico('baidu.com') },

  // ---- 实用应用 ----
  { cat: 'app', name: '百度网盘', url: 'https://pan.baidu.com', desc: '文件随时随地方便访问与分享', icon: ico('pan.baidu.com') },
  { cat: 'app', name: '阿里云盘', url: 'https://www.alipan.com', desc: '速度不以牺牲隐私为代价的云盘', icon: ico('alipan.com') },
  { cat: 'app', name: '夸克网盘', url: 'https://pan.quark.cn', desc: '大容量免费网盘，下载不限速', icon: ico('pan.quark.cn') },
  { cat: 'app', name: '腾讯文档', url: 'https://docs.qq.com', desc: '多人协作在线文档，随时随地进行创作', icon: ico('docs.qq.com') },
  { cat: 'app', name: '石墨文档', url: 'https://shimo.im', desc: '简洁优雅的在线协作文档', icon: ico('shimo.im') },
  { cat: 'app', name: '幕布', url: 'https://mubu.com', desc: '大纲笔记与思维导图一键转换', icon: ico('mubu.com') },
  { cat: 'app', name: 'ProcessOn', url: 'https://www.processon.com', desc: '在线流程图、思维导图、原型图绘制', icon: ico('processon.com') },
  { cat: 'app', name: 'Canva 可画', url: 'https://www.canva.cn', desc: '海量模板的在线平面设计工具', icon: ico('canva.cn') },
  { cat: 'app', name: 'DeepL 翻译', url: 'https://www.deepl.com/translator', desc: '精准译文的 AI 翻译工具', icon: ico('deepl.com') },
  { cat: 'app', name: '百度翻译', url: 'https://fanyi.baidu.com', desc: '支持多语言互译，词典例句齐全', icon: ico('fanyi.baidu.com') },
  { cat: 'app', name: '高德地图', url: 'https://www.amap.com', desc: '地图、导航、路况实时查询', icon: ico('amap.com') },
  { cat: 'app', name: '百度地图', url: 'https://map.baidu.com', desc: '智能路线规划与周边生活查询', icon: ico('map.baidu.com') },

  // ---- 新闻资讯 ----
  { cat: 'news', name: '腾讯新闻', url: 'https://news.qq.com', desc: '时事热点快速了解', icon: ico('news.qq.com') },
  { cat: 'news', name: '网易新闻', url: 'https://news.163.com', desc: '有态度的新闻门户', icon: ico('news.163.com') },
  { cat: 'news', name: '今日头条', url: 'https://www.toutiao.com', desc: '你关心的才是头条', icon: ico('toutiao.com') },
  { cat: 'news', name: '澎湃新闻', url: 'https://www.thepaper.cn', desc: '专注时政与思想的互联网原创新闻', icon: ico('thepaper.cn') },
  { cat: 'news', name: '界面新闻', url: 'https://www.jiemian.com', desc: '只服务于独立思考的人群', icon: ico('jiemian.com') },
  { cat: 'news', name: '36氪', url: 'https://36kr.com', desc: '让一部分人先看到未来', icon: ico('36kr.com') },
  { cat: 'news', name: '虎嗅', url: 'https://www.huxiu.com', desc: '从思考，到创造', icon: ico('huxiu.com') },
  { cat: 'news', name: '新浪新闻', url: 'https://news.sina.com.cn', desc: '全球资讯24小时不间断', icon: ico('news.sina.com.cn') },
  { cat: 'news', name: '环球网', url: 'https://www.huanqiu.com', desc: '全球时事资讯门户', icon: ico('huanqiu.com') },

  // ---- 影音视频 ----
  { cat: 'video', name: '爱奇艺', url: 'https://www.iqiyi.com', desc: '悦享品质，热门剧集综艺', icon: ico('iqiyi.com') },
  { cat: 'video', name: '腾讯视频', url: 'https://v.qq.com', desc: '海量影视综艺动漫', icon: ico('v.qq.com') },
  { cat: 'video', name: '优酷', url: 'https://www.youku.com', desc: '剧集综艺电影一网打尽', icon: ico('youku.com') },
  { cat: 'video', name: '芒果TV', url: 'https://www.mgtv.com', desc: '湖南卫视官方视频平台', icon: ico('mgtv.com') },
  { cat: 'video', name: '西瓜视频', url: 'https://www.ixigua.com', desc: '给你新鲜好看的短视频与中视频', icon: ico('ixigua.com') },
  { cat: 'video', name: 'QQ音乐', url: 'https://y.qq.com', desc: '千万正版曲库在线试听', icon: ico('y.qq.com') },
  { cat: 'video', name: '酷狗音乐', url: 'https://www.kugou.com', desc: '就是歌多，海量曲库免费听', icon: ico('kugou.com') },
  { cat: 'video', name: '酷我音乐', url: 'https://www.kuwo.cn', desc: '无损音乐免费听', icon: ico('kuwo.cn') },
  { cat: 'video', name: '咪咕音乐', url: 'https://music.migu.cn', desc: '演唱会直播与正版曲库', icon: ico('music.migu.cn') },

  // ---- 图片设计 ----
  { cat: 'image', name: '花瓣网', url: 'https://huaban.com', desc: '采集灵感的设计素材社区', icon: ico('huaban.com') },
  { cat: 'image', name: '站酷', url: 'https://www.zcool.com.cn', desc: '设计师互动平台，设计创意聚集地', icon: ico('zcool.com.cn') },
  { cat: 'image', name: '千图网', url: 'https://www.58pic.com', desc: '免费设计素材下载', icon: ico('58pic.com') },
  { cat: 'image', name: '包图网', url: 'https://ibaotu.com', desc: '原创商用设计素材库', icon: ico('ibaotu.com') },
  { cat: 'image', name: '摄图网', url: 'https://699pic.com', desc: '正版商业高清图库', icon: ico('699pic.com') },
  { cat: 'image', name: 'Unsplash', url: 'https://unsplash.com', desc: '高质量免费无版权图片', icon: ico('unsplash.com') },
  { cat: 'image', name: 'Pexels', url: 'https://www.pexels.com', desc: '免费商用图片与视频素材', icon: ico('pexels.com') },
  { cat: 'image', name: '稿定设计', url: 'https://www.gaoding.com', desc: '一键在线作图与抠图', icon: ico('gaoding.com') },

  // ---- 购物与团购 ----
  { cat: 'shop', name: '京东商城', url: 'https://www.jd.com', desc: '自营正品，次日送达', icon: ico('jd.com') },
  { cat: 'shop', name: '淘宝网', url: 'https://www.taobao.com', desc: '万能的淘宝，什么都有', icon: ico('taobao.com') },
  { cat: 'shop', name: '天猫', url: 'https://www.tmall.com', desc: '理想生活上天猫，品牌官方旗舰店', icon: ico('tmall.com') },
  { cat: 'shop', name: '拼多多', url: 'https://www.pinduoduo.com', desc: '拼着买更便宜', icon: ico('pinduoduo.com') },
  { cat: 'shop', name: '苏宁易购', url: 'https://www.suning.com', desc: '家电数码一站式购齐', icon: ico('suning.com') },
  { cat: 'shop', name: '唯品会', url: 'https://www.vip.com', desc: '品牌特卖，正品低价', icon: ico('vip.com') },
  { cat: 'shop', name: '闲鱼', url: 'https://www.goofish.com', desc: '闲置二手交易平台', icon: ico('goofish.com') },
  { cat: 'shop', name: '转转', url: 'https://www.zhuanzhuan.com', desc: '专业二手交易，验机保障', icon: ico('zhuanzhuan.com') },

  // ---- 社交与博客 ----
  { cat: 'social', name: '微博', url: 'https://weibo.com', desc: '热搜榜与明星动态第一站', icon: ico('weibo.com') },
  { cat: 'social', name: '知乎', url: 'https://www.zhihu.com', desc: '有问题就会有答案', icon: ico('zhihu.com') },
  { cat: 'social', name: '小红书', url: 'https://www.xiaohongshu.com', desc: '生活经验与种草笔记', icon: ico('xiaohongshu.com') },
  { cat: 'social', name: '豆瓣', url: 'https://www.douban.com', desc: '小组与同城兴趣社区', icon: ico('douban.com') },
  { cat: 'social', name: '即刻', url: 'https://web.okjike.com', desc: '兴趣社交社区，遇见同好', icon: ico('okjike.com') },
  { cat: 'social', name: '少数派', url: 'https://sspai.com', desc: '高质量数字生活指南', icon: ico('sspai.com') },
  { cat: 'social', name: '简书', url: 'https://www.jianshu.com', desc: '优质原创内容社区', icon: ico('jianshu.com') },
  { cat: 'social', name: '博客园', url: 'https://www.cnblogs.com', desc: '开发者博客与IT技术文章', icon: ico('cnblogs.com') },

  // ---- 体育与旅行 ----
  { cat: 'travel', name: '携程旅行', url: 'https://www.ctrip.com', desc: '酒店机票火车票度假预订', icon: ico('ctrip.com') },
  { cat: 'travel', name: '飞猪', url: 'https://www.fligo.com', desc: '阿里旗下在线旅游平台', icon: ico('fligo.com') },
  { cat: 'travel', name: '去哪儿', url: 'https://www.qunar.com', desc: '比价订机票酒店更省', icon: ico('qunar.com') },
  { cat: 'travel', name: '马蜂窝', url: 'https://www.mafengwo.cn', desc: '旅游攻略与自由行社区', icon: ico('mafengwo.cn') },
  { cat: 'travel', name: '同程旅行', url: 'https://www.ly.com', desc: '机票酒店火车票省钱订', icon: ico('ly.com') },
  { cat: 'travel', name: '12306', url: 'https://www.12306.cn', desc: '中国铁路官方购票网站', icon: ico('12306.cn') },
  { cat: 'travel', name: '虎扑', url: 'https://www.hupu.com', desc: '体育赛事与球迷社区', icon: ico('hupu.com') },
  { cat: 'travel', name: '直播吧', url: 'https://www.zhibo8.cc', desc: '体育赛事直播与比分', icon: ico('zhibo8.cc') },

  // ---- 生活方式 ----
  { cat: 'life', name: '下厨房', url: 'https://www.xiachufang.com', desc: '美食菜谱与烹饪分享社区', icon: ico('xiachufang.com') },
  { cat: 'life', name: '大众点评', url: 'https://www.dianping.com', desc: '本地美食休闲娱乐指南', icon: ico('dianping.com') },
  { cat: 'life', name: '美团', url: 'https://www.meituan.com', desc: '吃住行玩全覆盖的生活服务', icon: ico('meituan.com') },
  { cat: 'life', name: '饿了么', url: 'https://www.ele.me', desc: '外卖点餐跑腿代购', icon: ico('ele.me') },
  { cat: 'life', name: '58同城', url: 'https://www.58.com', desc: '本地生活信息分类平台', icon: ico('58.com') },
  { cat: 'life', name: '丁香医生', url: 'https://dxy.com', desc: '靠谱的健康医疗信息', icon: ico('dxy.com') },
  { cat: 'life', name: '贝壳找房', url: 'https://www.ke.com', desc: '真房源租房买房平台', icon: ico('ke.com') },

  // ---- 游戏与娱乐 ----
  { cat: 'game', name: 'TapTap', url: 'https://www.taptap.cn', desc: '发现好游戏，玩家真实评价', icon: ico('taptap.cn') },
  { cat: 'game', name: 'Steam', url: 'https://store.steampowered.com', desc: '全球最大PC游戏发行平台', icon: ico('steampowered.com') },
  { cat: 'game', name: 'Epic Games', url: 'https://store.epicgames.com', desc: '每周免费领游戏', icon: ico('epicgames.com') },
  { cat: 'game', name: '4399', url: 'https://www.4399.com', desc: '在线小游戏大全', icon: ico('4399.com') },
  { cat: 'game', name: '17173', url: 'https://www.17173.com', desc: '网络游戏门户与资讯', icon: ico('17173.com') },
  { cat: 'game', name: 'NGA', url: 'https://bbs.nga.cn', desc: '精英玩家社区', icon: ico('nga.cn') },
  { cat: 'game', name: '小黑盒', url: 'https://www.xiaoheihe.cn', desc: 'Steam游戏社区与折扣信息', icon: ico('xiaoheihe.cn') },
  { cat: 'game', name: '米游社', url: 'https://www.miyoushe.com', desc: '米哈游官方玩家社区', icon: ico('miyoushe.com') },

  // ---- 教育与招聘 ----
  { cat: 'edu', name: '中国大学MOOC', url: 'https://www.icourse163.org', desc: '名校公开课免费学习', icon: ico('icourse163.org') },
  { cat: 'edu', name: '学堂在线', url: 'https://www.xuetangx.com', desc: '清华大学发起的慕课平台', icon: ico('xuetangx.com') },
  { cat: 'edu', name: '网易公开课', url: 'https://open.163.com', desc: '国内外名校公开课全集', icon: ico('open.163.com') },
  { cat: 'edu', name: '力扣 LeetCode', url: 'https://leetcode.cn', desc: '算法刷题与技术面试准备', icon: ico('leetcode.cn') },
  { cat: 'edu', name: '牛客网', url: 'https://www.nowcoder.com', desc: '笔试题库与求职面经', icon: ico('nowcoder.com') },
  { cat: 'edu', name: 'BOSS直聘', url: 'https://www.zhipin.com', desc: '与老板直接聊的工作招聘', icon: ico('zhipin.com') },
  { cat: 'edu', name: '智联招聘', url: 'https://www.zhaopin.com', desc: '综合职位搜索与投递', icon: ico('zhaopin.com') },
  { cat: 'edu', name: '拉勾网', url: 'https://www.lagou.com', desc: '互联网行业招聘平台', icon: ico('lagou.com') },
  { cat: 'edu', name: '多邻国', url: 'https://www.duolingo.cn', desc: '游戏化免费学外语', icon: ico('duolingo.cn') },

  // ---- 数码科技 ----
  { cat: 'tech', name: 'IT之家', url: 'https://www.ithome.com', desc: '科技数码热点资讯', icon: ico('ithome.com') },
  { cat: 'tech', name: '酷安', url: 'https://www.coolapk.com', desc: '高质量手机应用与数码社区', icon: ico('coolapk.com') },
  { cat: 'tech', name: '中关村在线', url: 'https://www.zol.com.cn', desc: '硬件评测与装机报价', icon: ico('zol.com.cn') },
  { cat: 'tech', name: '太平洋科技', url: 'https://www.pconline.com.cn', desc: '电脑数码产品资讯评测', icon: ico('pconline.com.cn') },
  { cat: 'tech', name: '爱范儿', url: 'https://www.ifanr.com', desc: '报道未来，服务新生活引领者', icon: ico('ifanr.com') },
  { cat: 'tech', name: '雷锋网', url: 'https://www.leiphone.com', desc: '关注智能与未来的科技媒体', icon: ico('leiphone.com') },
  { cat: 'tech', name: '极客公园', url: 'https://www.geekpark.net', desc: '创新者社区与科技报道', icon: ico('geekpark.net') },

  // ---- 金融理财 ----
  { cat: 'finance', name: '雪球', url: 'https://xueqiu.com', desc: '聪明的投资者都在这里', icon: ico('xueqiu.com') },
  { cat: 'finance', name: '东方财富', url: 'https://www.eastmoney.com', desc: '行情、数据、资讯一站式', icon: ico('eastmoney.com') },
  { cat: 'finance', name: '同花顺', url: 'https://www.10jqka.com.cn', desc: '股票行情与投资工具', icon: ico('10jqka.com.cn') },
  { cat: 'finance', name: '天天基金', url: 'https://fund.eastmoney.com', desc: '基金申购与数据排行', icon: ico('fund.eastmoney.com') },
  { cat: 'finance', name: '集思录', url: 'https://www.jisilu.cn', desc: '低风险套利投资社区', icon: ico('jisilu.cn') },
  { cat: 'finance', name: '招商银行', url: 'https://www.cmbchina.com', desc: '网上银行与财富管理', icon: ico('cmbchina.com') },
  { cat: 'finance', name: '工商银行', url: 'https://www.icbc.com.cn', desc: '中国工商银行官网', icon: ico('icbc.com.cn') },
  { cat: 'finance', name: '富途牛牛', url: 'https://www.futunn.com', desc: '港股美股行情交易', icon: ico('futunn.com') },

  // ---- 阅读小说 ----
  { cat: 'read', name: '微信读书', url: 'https://weread.qq.com', desc: '正版书籍与出版读物', icon: ico('weread.qq.com') },
  { cat: 'read', name: '豆瓣读书', url: 'https://book.douban.com', desc: '书评评分与书单推荐', icon: ico('book.douban.com') },
  { cat: 'read', name: '起点读书', url: 'https://www.qidian.com', desc: '网络文学原创平台', icon: ico('qidian.com') },
  { cat: 'read', name: '晋江文学城', url: 'https://www.jjwxc.net', desc: '女性向原创小说基地', icon: ico('jjwxc.net') },
  { cat: 'read', name: '番茄小说', url: 'https://fanqienovel.com', desc: '海量免费网络小说', icon: ico('fanqienovel.com') },
  { cat: 'read', name: '得到', url: 'https://www.dedao.cn', desc: '知识服务与听书课程', icon: ico('dedao.cn') },
  { cat: 'read', name: '掌阅', url: 'https://www.zhangyue.com', desc: '精品图书电子书阅读', icon: ico('zhangyue.com') },

  // ---- 开发工具 ----
  { cat: 'dev', name: 'GitHub', url: 'https://github.com', desc: '全球最大的代码托管平台', icon: ico('github.com') },
  { cat: 'dev', name: 'Gitee', url: 'https://gitee.com', desc: '国内代码托管与开源社区', icon: ico('gitee.com') },
  { cat: 'dev', name: 'Stack Overflow', url: 'https://stackoverflow.com', desc: '程序员问答社区', icon: ico('stackoverflow.com') },
  { cat: 'dev', name: 'MDN Web Docs', url: 'https://developer.mozilla.org', desc: 'Web 技术权威文档', icon: ico('developer.mozilla.org') },
  { cat: 'dev', name: 'npm', url: 'https://www.npmjs.com', desc: 'JavaScript 包管理仓库', icon: ico('npmjs.com') },
  { cat: 'dev', name: 'Can I Use', url: 'https://caniuse.com', desc: '浏览器兼容性查询', icon: ico('caniuse.com') },
  { cat: 'dev', name: 'V2EX', url: 'https://www.v2ex.com', desc: '创意工作者社区', icon: ico('v2ex.com') },
  { cat: 'dev', name: '掘金', url: 'https://juejin.cn', desc: '开发者技术文章社区', icon: ico('juejin.cn') },
  { cat: 'dev', name: 'CSDN', url: 'https://www.csdn.net', desc: 'IT技术博客与学习资源', icon: ico('csdn.net') },
  { cat: 'dev', name: '阿里云', url: 'https://www.aliyun.com', desc: '云计算服务与开发者权益', icon: ico('aliyun.com') },
  { cat: 'dev', name: '腾讯云', url: 'https://cloud.tencent.com', desc: '云服务与开发者实验室', icon: ico('cloud.tencent.com') },
]

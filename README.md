# 项目本地运行指南

## 1. 安装依赖（Requirements）

如果默认的官方国外源安装依赖较慢或网络连接失败，可以切换为国内淘宝/阿里镜像源：

```bash
# 切换为国内镜像源（推荐，如果国外源超时/卡顿）
npm config set registry https://registry.npmmirror.com

# 还原回官方默认源（如果需要）
# npm config set registry https://registry.npmjs.org/
```

然后安装依赖包（相当于 Python 中的 `pip install -r requirements.txt`）：

```bash
npm install
```

---

## 2. 启动前端开发服务器

在本地拉起调试预览服务器（支持热重载，保存代码即可在浏览器即时看到更新）：

```bash
npm run dev
```

启动成功后，在浏览器中访问：[http://localhost:3000](http://localhost:3000)

---

## 3. 构建与打包

```bash
# 生产环境编译构建
npm run build

# 生产环境启动
npm run start
```

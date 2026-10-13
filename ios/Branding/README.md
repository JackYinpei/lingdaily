# LingDaily iOS Logo

双对话气泡延续「练习」Tab 的意象，表示两个人开口交流。配色读取
`DesignSystem/Brand.swift` 的纸色、墨色和朱红，浅色、深色及系统着色图标
均为无透明通道的 1024 × 1024 PNG，由 Xcode 的 `AppIcon` 资源集编译。
桌面圆角由系统裁切，源图不预加圆角。

`Logo.svg` 是可复用的矢量版本。修改配色或路径后，从仓库根目录重新生成：

```bash
swift ios/Branding/generate-app-icon.swift
```

图标生效需要重新构建并安装 App。

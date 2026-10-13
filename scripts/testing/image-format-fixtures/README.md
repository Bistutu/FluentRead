# 图片格式测试夹具

这些图片由 `../generate-image-format-fixtures.py` 自行绘制，使用 Pillow 自带字体；未复制第三方图片或图标。每张图包含大字号英文和格式对应的独特短句，用于实际 OCR、翻译、译图及原图切换测试，避免重复短句使跨格式测试只命中翻译缓存。

基线覆盖 WebP、GIF、BMP、AVIF 和含 256 × 256 版本的多尺寸 ICO。变体覆盖透明白字 WebP／GIF／AVIF，以及两帧 GIF／WebP。动图两帧的文字、位置与背景明显不同，用于发现 OCR 与重绘使用不同帧的问题；`expectedSource` 和 `firstFrameProbe` 对应第一帧，完整流程生成静态译图，不要求逐帧翻译。

`manifest.json` 中的路径相对 manifest；SHA-256 和字节数锁定实际测试输入。`transparentProbe` 标明应保持透明的背景像素。测试运行使用已提交夹具，不需要 Python；重新生成需要支持 WebP 和 AVIF 的 Pillow（本次为 12.3.0）：

```sh
python3 scripts/testing/generate-image-format-fixtures.py
```

生成器会重新读取编码结果，检查尺寸、帧数及透明度是否保留。更新 Pillow 或编解码库后，编码字节可能变化，需要一并更新 manifest 并重新验证。

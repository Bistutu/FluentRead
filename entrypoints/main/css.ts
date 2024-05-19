import {options} from "@/entrypoints/utils/option";

const css = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.fluent-read-loading {
  border: 3px solid #f3f3f3; /* 轨迹灰色 */
  border-top: 3px solid blue;   /* 主色调，首次翻译蓝色、缓存应改为绿色 */
  border-radius: 50%;
  width: 12px;
  height: 12px;
  animation: spin 1s linear infinite;
  display: inline-block;
}

.fluent-read-retry-wrapper {
  display: inline-flex;
  align-items: center;
}
.fluent-read-retry, .fluent-read-reason {
  color: #428ADF;
  text-decoration: underline;
  text-underline-offset: 0.2em;
  margin-left: 0.2em;
  font-size: 1em;
  cursor: pointer;
}

/* display 译文显示样式*/

/* 弱化 */
.fluent-display-dimmed {
    opacity: 0.5;
}

/* 实线下划线 */
.fluent-display-solid-underline {
    text-decoration: underline;
}

/* 虚线下划线 */
.fluent-display-dot-underline {
    text-decoration: underline dotted;
}

/* 学习模式 */
.fluent-display-learning-mode {
    filter: blur(4px);
    transition: filter 0.3s;
}
.fluent-display-learning-mode:hover {
    filter: none;
}

/* 透明模式 */
.fluent-display-transparent-mode {
    opacity: 0.5;
    transition: opacity 0.3s;
}
.fluent-display-transparent-mode:hover {
    opacity: 1;
}

/* 阴影效果 */
.fluent-display-card-mode {
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.1); /* 加强阴影的尺寸和不透明度 */
    padding: 2px;
    border-radius: 5px;
}

/* 马克笔 */
.fluent-display-marker {
    background: linear-gradient(to right,
        rgba(251, 218, 65, 0.1),
        rgba(251, 218, 65, 0.9) 3%,
        rgba(251, 218, 65, 0.9) 35%,
        rgba(251, 218, 65, 0.9) 70%,
        rgba(251, 218, 65, 0.8) 95%,
        rgba(251, 218, 65, 0.3));
    padding: 0 2px;
}


/* 引用 */
.fluent-display-quote {
    font-style: italic;
    color: grey;
    border-left: 3px solid #cc3355;
    padding-left: 10px;
}

/* 加粗 */
.fluent-display-bold {
    font-weight: bold;
}

`;

export function cssInject() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
}

// 移除特定样式
export function checkAndRemoveStyle(node: any, styleProperty: any) {
    if (node.style && node.style[styleProperty] !== undefined) {
        node.style[styleProperty] = ''; // 置为空
    }
}

// 移除特定样式
export function smashTruncationStyle(node: any) {
    checkAndRemoveStyle(node, ' webkitLineClamp');
    node.style.webkitLineClamp='unset';
    node.style.maxHeight='unset';
}
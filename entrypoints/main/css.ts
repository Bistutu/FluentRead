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
`;

export function cssInject() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
}

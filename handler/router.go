package handler

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func NewRouter() *gin.Engine {

	engine := gin.Default()

	// 允许所有跨域请求
	engine.Use(cors.Default())
	// 加载静态资源
	engine.StaticFile("/", "./static")

	// 绑定路由
	engine.POST("/preread", PreReadHandler) // 预读接口
	engine.POST("/read", ReadHandler)       // 按 host 全文读取接口
	engine.POST("/trans", TransHandler)     // 翻译接口
	engine.POST("/collect", CollectHandler) // 前端文本收集接口（暂未实现）

	return engine
}

package initialize

import (
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"FluentRead/handler"
)

func NewRouter() *gin.Engine {

	engine := gin.Default()

	// 允许所有跨域请求
	engine.Use(cors.Default())

	// 绑定路由
	engine.POST("/read", handler.ReadHandler)
	engine.POST("/preread", handler.PreReadHandler)
	engine.POST("/parse", handler.ParseHandler)

	return engine
}

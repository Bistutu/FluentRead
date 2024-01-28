package main

import (
	"fmt"

	"FluentRead/handler"
	"FluentRead/misc/log"
	_ "FluentRead/repo/db"
	"FluentRead/utils"
)

func main() {
	engine := handler.NewRouter()
	// 如果环境变量端口为空，则使用默认端口 12345
	if err := engine.Run(fmt.Sprintf(":%s", utils.GetEnvDefault("PORT", "12345"))); err != nil {
		log.Errorf("服务启动失败: %v", err)
		panic(err)
	}
}

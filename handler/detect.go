package handler

import (
	"github.com/gin-gonic/gin"

	"FluentRead/logic"
	"FluentRead/misc/log"
)

var detectCount = 1

func DetectHandler(c *gin.Context) {

	log.Infof("第 %d 次 detect 请求", detectCount)
	detectCount++

	// 获取请求参数，post 请求 text=正文
	rawData, _ := c.GetRawData()
	rawString := string(rawData)
	// 检测
	if len(rawString) >= 5 && rawString[:5] == "text=" {
		rawString = rawString[5:]
	} else {
		c.JSON(400, gin.H{"error": "请求格式错误"})
		return
	}
	language := logic.DetectLanguage(rawString)
	c.JSON(200, gin.H{"language": language})
}

package handler

import (
	"github.com/gin-gonic/gin"

	"FluentRead/logic"
	"FluentRead/misc/log"
	"FluentRead/models"
)

var count = 1

func PreReadHandler(c *gin.Context) {

	log.Infof("第 %d 次 preread 请求", count)
	count++

	data, err := logic.PreRead(c)
	if err != nil {
		c.JSON(500, err)
		return
	}

	c.JSON(200, models.Success(data))
	return
}

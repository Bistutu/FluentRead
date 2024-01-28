// Package utils 常见错误
package utils

import (
	"github.com/gin-gonic/gin"

	"FluentRead/misc/log"
	"FluentRead/models"
)

const (
	badRequest  = "不合法的请求"
	systemError = "系统错误，请稍后重试"
)

// CallbackBadRequest 不合法的请求
func CallbackBadRequest(c *gin.Context, err error) {
	log.Error(badRequest, err)
	c.JSON(400, models.Fail(badRequest))
}

// CallbackSystemError 系统错误
func CallbackSystemError(c *gin.Context, err error) {
	log.Error(systemError, err)
	c.JSON(500, models.Fail(systemError))
}

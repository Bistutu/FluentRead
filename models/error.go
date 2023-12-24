// Package models 常见错误
package models

import (
	"github.com/gin-gonic/gin"

	"FluentRead/misc/log"
)

// SendBadRequestResp 不合法的请求
func SendBadRequestResp(c *gin.Context, err error) {
	log.Errorf("不合法的请求：%v", err)
	c.JSON(400, &Result{Code: -1, Msg: "不合法的请求！", Data: nil})
}

// SendSystemErrorResp 系统错误
func SendSystemErrorResp(c *gin.Context, err error) {
	log.Errorf("系统错误：%v", err)
	c.JSON(500, &Result{Code: -1, Msg: "系统错误，请稍后重试~", Data: nil})
}

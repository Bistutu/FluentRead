package handler

import (
	"encoding/json"
	"net/url"

	"github.com/gin-gonic/gin"

	"FluentRead/logic"
	"FluentRead/models"
	"FluentRead/utils"
)

func ReadHandler(c *gin.Context) {

	// 获取请求参数与验证格式
	rawData, _ := c.GetRawData()
	var readRequest *models.ReadRequest
	if err := json.Unmarshal(rawData, &readRequest); err != nil {
		utils.CallbackBadRequest(c, err)
		return
	}

	// 检查 url 是否合法
	if parse, err := url.Parse(readRequest.Page); err != nil || parse.Host == "" {
		utils.CallbackBadRequest(c, err)
		return
	}

	switch {
	case len(readRequest.HashList) > 0:
		// 批量读取
		read, err := logic.BatchRead(c, readRequest.HashList)
		if err != nil {
			utils.CallbackSystemError(c, err)
			return
		}
		c.JSON(200, models.Success(read))
	default:
		// 按 host 全文读取
		resp, err := logic.PageRead(c, readRequest.Page)
		if err != nil {
			utils.CallbackSystemError(c, err)
			return
		}
		c.JSON(200, models.Success(resp))
	}
}

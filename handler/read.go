package handler

import (
	"encoding/json"
	"net/url"

	"github.com/gin-gonic/gin"

	"FluentRead/logic"
	"FluentRead/models"
)

func ReadHandler(c *gin.Context) {

	rawData, _ := c.GetRawData()

	var readRequest *models.ReadRequest
	if err := json.Unmarshal(rawData, &readRequest); err != nil {
		models.SendBadRequestResp(c, err)
		return
	}

	if parse, err := url.Parse(readRequest.Page); err != nil || parse.Host == "" {
		models.SendBadRequestResp(c, err)
		return
	}

	switch {
	case len(readRequest.HashList) > 0:
		// 批量读取
		read, err := logic.BatchRead(c, readRequest.HashList)
		if err != nil {
			models.SendSystemErrorResp(c, err)
			return
		}
		c.JSON(200, &models.Result{Code: 0, Msg: "ok", Data: read})
	default:
		// 按 host+path 全文读取
		resp, err := logic.PageRead(c, readRequest.Page)
		if err != nil {
			models.SendSystemErrorResp(c, err)
			return
		}
		c.JSON(200, &models.Result{Code: 0, Msg: "ok", Data: resp})
	}
}

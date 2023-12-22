package handler

import (
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/gin-gonic/gin"

	"FluentRead/logic"
	"FluentRead/models"
	"FluentRead/utils"
)

func ReadHandler(c *gin.Context) {

	rawData, _ := c.GetRawData()

	var readRequest *models.ReadRequest
	if err := json.Unmarshal(rawData, &readRequest); err != nil {
		utils.SendBadRequestResp(c, err)
		return
	}
	// TODO delete

	fmt.Printf("》》》》》%+v\n", readRequest)

	if parse, err := url.Parse(readRequest.Page); err != nil || parse.Host == "" {
		utils.SendBadRequestResp(c, err)
		return
	}

	switch {
	case len(readRequest.HashList) > 0:
		// 批量读取
		read, err := logic.BatchRead(c, readRequest.HashList)
		if err != nil {
			utils.SendSystemErrorResp(c, err)
			return
		}
		c.JSON(200, &models.Result{Code: 0, Msg: "ok", Data: read})
	default:
		// 按 host+path 全文读取
		resp, err := logic.PageRead(c, readRequest.Page)
		if err != nil {
			utils.SendSystemErrorResp(c, err)
			return
		}
		c.JSON(200, &models.Result{Code: 0, Msg: "ok", Data: resp})
	}
}

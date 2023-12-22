package handler

import (
	"github.com/gin-gonic/gin"

	"FluentRead/logic"
	"FluentRead/models"
)

func PreReadHandler(c *gin.Context) {

	read, err := logic.PreRead(c)
	if err != nil {
		c.JSON(500, err)
		return
	}

	c.JSON(200, models.OK(read))
	return
}

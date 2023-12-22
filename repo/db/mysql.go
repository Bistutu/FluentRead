package db

import (
	"fmt"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"FluentRead/misc/log"
	"FluentRead/models"
	"FluentRead/utils"
)

const (
	dsnFormat = "%s:%s@tcp(127.0.0.1:3306)/fluent_read?charset=utf8mb4&parseTime=True&loc=Local"
)

var db *gorm.DB

func init() {
	dsn := fmt.Sprintf(dsnFormat,
		utils.GetEnvDefault("MYSQL_USERNAME_FR", "fluent_read"),
		utils.GetEnvDefault("MYSQL_PASSWORD_FR", "kwaRhpptf57mfi7k"),
	)
	open, err := gorm.Open(mysql.Open(dsn))
	if err != nil {
		log.Errorf("数据库连接失败：%v", err)
		panic(err)
	}
	db = open
	// 自动创建表
	err = db.AutoMigrate(&models.Translation{}, &models.Page{})
	if err != nil {
		panic(err)
	}
}

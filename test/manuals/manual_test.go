package manuals

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"FluentRead/models"
	"FluentRead/repo/db"
	"FluentRead/utils"
)

var (
	ctx  = context.Background()
	link = utils.GetHostByString(
		"https://hub.docker.com/",
	)
)

func TestInsertTrans_JSON(t *testing.T) {

	pageId, err := db.InsertPage(ctx, &models.Page{Link: link})
	assert.NoError(t, err)

	// 打开文件
	file, err := os.Open("manual_json")
	assert.NoError(t, err)
	defer file.Close()

	bytes, err := io.ReadAll(file)
	assert.NoError(t, err)

	var data []string
	err = json.Unmarshal(bytes, &data)
	assert.NoError(t, err)

	for _, line := range data {
		if strings.TrimSpace(line) == "" {
			continue
		}
		signature := utils.Signature(link + line)
		db.InsertTrans(ctx, &models.Translation{
			Source:     line,
			Target:     "",
			Hash:       signature,
			Translated: false,
			TargetType: 0,
			PageId:     pageId,
		})
	}
}

func TestInsertTrans(t *testing.T) {
	pageId, err := db.InsertPage(ctx, &models.Page{Link: link})
	assert.NoError(t, err)

	// 打开文件
	file, err := os.Open("manual")
	assert.NoError(t, err)
	defer file.Close()

	// 创建一个Scanner去读取文件
	scanner := bufio.NewScanner(file)

	// 使用Scan循环读取文件的每一行
	for scanner.Scan() {
		line := scanner.Text() // Text()返回当前行的内容
		signature := utils.Signature(link + line)
		db.InsertTrans(ctx, &models.Translation{
			Source:     line,
			Target:     "",
			Hash:       signature,
			Translated: false,
			TargetType: 0,
			PageId:     pageId,
		})
	}
	// 检查Scan过程中是否有错误发生（文件结尾除外）
	if err := scanner.Err(); err != nil {
		log.Fatal(err)
	}
}

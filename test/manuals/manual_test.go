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
		//"https://openai.com/",
		//"https://platform.openai.com/apps",
		"https://chat.openai.com/",
	)
)

func TestInsertTrans_JSON(t *testing.T) {
	pageId, err := db.InsertPage(ctx, &models.Page{Link: link})
	assert.NoError(t, err)
	// 打开文件
	file, err := os.Open("manual.json")
	assert.NoError(t, err)
	defer file.Close()
	bytes, _ := io.ReadAll(file)

	var data []string
	err = json.Unmarshal(bytes, &data)
	assert.NoError(t, err)

	for _, line := range data {
		line = strings.TrimSpace(line)
		if !utils.IsEnglish(line) {
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

	// 创建 Scanner 循环读取文件的每一行
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text()) // Text()返回当前行的内容
		if !utils.IsEnglish(line) {
			continue
		}

		signature := utils.Signature(link + line)
		db.InsertTrans(ctx, &models.Translation{Source: line, Target: "", Hash: signature, Translated: false, TargetType: 0, PageId: pageId})
	}
	// 检查Scan过程中是否有错误发生（文件结尾除外）
	if err := scanner.Err(); err != nil {
		log.Fatal(err)
	}
}

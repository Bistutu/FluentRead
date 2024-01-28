package manuals

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"FluentRead/models"
	"FluentRead/repo/cache"
	"FluentRead/repo/db"
	"FluentRead/utils"
)

var (
	ctx  = context.Background()
	link = utils.GetHost(
		//"https://openai.com/",
		//"https://platform.openai.com/apps",
		"https://chat.openai.com/",
		//"https://hub.docker.com/search?q=",
		//"https://mvnrepository.com/artifact/com.alibaba/fastjson/2.0.44",
		//"https://help.openai.com/en/articles/8554397-creating-a-gpt",
		//"https://platform.openai.com/docs/overview",
		//"https://mvnrepository.com/repos",
		//"https://www.nexusmods.com/",
		//"https://users.nexusmods.com/",
		//"https://www.coze.com/space/7313028917407842311/plugin",
	)
)

func TestInsertTrans_JSON(t *testing.T) {
	pageId, err := db.InsertOrUpdatePage(ctx, &models.Page{Link: link})
	assert.NoError(t, err)
	// 删除缓存
	cache.RemoveKey(ctx, "preread")
	cache.RemoveKey(ctx, fmt.Sprintf("page:%s", link))

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

		signature := models.Signature(link + line)
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
	pageId, err := db.InsertOrUpdatePage(ctx, &models.Page{Link: link})
	assert.NoError(t, err)
	// 删除缓存
	cache.RemoveKey(ctx, "preread")
	cache.RemoveKey(ctx, fmt.Sprintf("page:%s", link))
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

		signature := models.Signature(link + line)
		db.InsertTrans(ctx, &models.Translation{Source: line, Target: "", Hash: signature, Translated: false, TargetType: 0, PageId: pageId})
	}
	// 检查Scan过程中是否有错误发生（文件结尾除外）
	if err := scanner.Err(); err != nil {
		log.Fatal(err)
	}
}

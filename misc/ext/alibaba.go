package ext

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	alimt20181012 "github.com/alibabacloud-go/alimt-20181012/v2/client"
	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	util "github.com/alibabacloud-go/tea-utils/v2/service"
	"github.com/alibabacloud-go/tea/tea"
)

func AliTrans(raw string) (string, error) {
	user := tea.String(os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_ID"))
	pass := tea.String(os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET"))
	client, err := CreateClient(user, pass)
	if err != nil {
		panic(err)
	}

	translateGeneralRequest := &alimt20181012.TranslateGeneralRequest{
		FormatType:     tea.String("text"),
		SourceLanguage: tea.String("en"),
		TargetLanguage: tea.String("zh"),
		SourceText:     tea.String(raw),
		Context:        tea.String("程序员/开发者/Developer"),
		Scene:          tea.String("general"),
	}
	runtime := &util.RuntimeOptions{}
	translatedText, tryErr := func() (string, error) {
		defer func() {
			if r := tea.Recover(recover()); r != nil {
				err = r
			}
		}()
		msg, err := client.TranslateGeneralWithOptions(translateGeneralRequest, runtime)
		if err != nil {
			return "", err
		}
		return *msg.Body.Data.Translated, nil
	}()

	if tryErr != nil {

		var error = &tea.SDKError{}
		var _t *tea.SDKError
		if errors.As(tryErr, &_t) {
			error = _t
		}
		// 错误 message
		fmt.Println(tea.StringValue(error.Message))
		// 诊断地址
		var data interface{}
		d := json.NewDecoder(strings.NewReader(tea.StringValue(error.Data)))
		d.Decode(&data)
		if m, ok := data.(map[string]interface{}); ok {
			recommend, _ := m["Recommend"]
			fmt.Println(recommend)
		}
		_, err := util.AssertAsString(error.Message)
		if err != nil {
			return "", err
		}
	}
	return translatedText, nil
}

func CreateClient(accessKeyId *string, accessKeySecret *string) (_result *alimt20181012.Client, _err error) {
	config := &openapi.Config{
		AccessKeyId:     accessKeyId,
		AccessKeySecret: accessKeySecret,
	}
	config.Endpoint = tea.String("mt.aliyuncs.com")
	_result = &alimt20181012.Client{}
	_result, _err = alimt20181012.NewClient(config)
	return _result, _err
}

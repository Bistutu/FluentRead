package utils

import (
	"io"
	"net/http"
)

const (
	contentType = "Content-Type"
	userAgent   = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
)

var client *http.Client
var clientNoRedirect *http.Client

func init() {
	client = &http.Client{}
	clientNoRedirect = &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse // 返回此错误阻止重定向
		},
	}
}

// Get 模拟客户端发送 GET 请求
func Get(link string) (*http.Response, error) {
	request, _ := http.NewRequest("GET", link, nil)
	request.Header.Set(contentType, userAgent)
	request.Header.Set("user-agent", userAgent)
	return client.Do(request)
}

func Post(link string, data io.Reader) (*http.Response, error) {
	request, _ := http.NewRequest("POST", link, data)
	request.Header.Set(contentType, userAgent)
	return client.Do(request)
}

func FetchRedirectURL(link string) (string, error) {
	resp, err := clientNoRedirect.Get(link)
	if err != nil {
		return "", err
	}
	return resp.Header.Get("Location"), nil
}

package spider

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

	"golang.org/x/net/html"

	"FluentRead/misc/log"
	"FluentRead/models"
	"FluentRead/repo/db"
	"FluentRead/utils"
)

const (
	doubleSlash = "://"
)

// 爬取单个页面
func snifferSingle(ctx context.Context, link string) error {

	count := 1 // 统计文字数量

	root, err := fetchHTML(link)
	if err != nil {
		log.Errorf("链接访问失败: %v", err)
		return err
	}

	parsedUrl, err := url.Parse(link)
	if err != nil {
		log.Errorf("链接解析失败: %v", err)
		return err
	}
	// 只取 host
	link = parsedUrl.Host

	pageId, err := db.InsertPage(ctx, &models.Page{Link: link})
	if err != nil {
		log.Errorf("数据库 pages 插入链接失败: %v", err)
		return err
	}
	fmt.Printf("pageId: %d, link: %s\n", pageId, link)

	// dfs 遍历
	parseDFS(ctx, parsedUrl, root, nil, pageId, count)

	return nil
}

// sniffer 按友链爬取网页文本
func sniffer(ctx context.Context, link string) error {
	// 计数器
	count := 1
	// 页面链接队列
	queue := models.Queue{}

	// bfs 遍历
	queue.PushBack(link)
	visited := make(map[string]bool)

	for queue.Len() > 0 {
		// 弹出一个链接
		link := queue.Pop()

		// 解析初始链接，获取主机名
		parsedUrl, err := url.Parse(link)
		if err != nil {
			log.Errorf("链接解析失败: %v", err)
			continue
		}
		link = parsedUrl.Host

		// 如果已经访问过，则跳过
		if visited[link] {
			continue
		}
		visited[link] = true
		// pages 表插入新链接
		pageId, err := db.InsertPage(ctx, &models.Page{Link: link})
		if err != nil {
			log.Errorf("数据库 pages 插入链接失败: %v", err)
			return err
		}
		fmt.Printf("pageId: %d, link: %s\n", pageId, link)

		root, err := fetchHTML(parsedUrl.Scheme + doubleSlash + link + parsedUrl.Path)
		if err != nil {
			continue
		}

		// dfs 遍历
		parseDFS(ctx, parsedUrl, root, &queue, pageId, count)
	}
	return nil
}

// 获取 html 资源
func fetchHTML(link string) (*html.Node, error) {
	resp, err := utils.Get(link)
	if err != nil {
		log.Errorf("链接访问失败: %v", err)
		return nil, err
	}
	defer resp.Body.Close()

	bytes, _ := io.ReadAll(resp.Body)
	fmt.Println(string(bytes))

	// 解析页面后，主动关闭资源
	root, err := html.Parse(resp.Body)
	if err != nil {
		log.Errorf("html 页面解析失败: %v", err)
		return nil, err
	}
	return root, nil
}

// dfs 遍历
func parseDFS(ctx context.Context, parsedUrl *url.URL, node *html.Node, queue *models.Queue, pageId uint, count int) int {
	// node.Type 为节点类型，node.Data 为标签名
	switch {
	case node.Type == html.ElementNode && utils.IsContain(node.Data, []string{"script", "style", "img", "noscript"}):
		return count
	case node.Type == html.ElementNode && node.Data == "a":
		parseHref(ctx, parsedUrl, node, queue)
		fallthrough
	case node.Type == html.TextNode:
		parseText(ctx, parsedUrl, node, pageId, count)
		count++
	}
	for c := node.FirstChild; c != nil; c = c.NextSibling {
		count = parseDFS(ctx, parsedUrl, c, queue, pageId, count)
	}
	return count
}

// 解析文本
func parseText(ctx context.Context, parsedUrl *url.URL, node *html.Node, pageId uint, count int) {
	// 获取标准化的域名：host + path

	text := strings.TrimSpace(node.Data)
	text = strings.ReplaceAll(text, "\u00A0", " ")

	// 如果文本长度大于 0，且全是英文，则插入数据库
	if len(text) > 0 && utils.IsNonChinese(text) {
		// 签名
		signature := models.Signature(parsedUrl.Host + text)

		db.InsertTrans(ctx, &models.Translation{
			Source:     text,
			Target:     "",
			Hash:       signature,
			Translated: false,
			TargetType: 0,
			PageId:     pageId,
		}) // link + text，去重 Source:     text, TargetType: 1, Target: "",

		fmt.Println(count, parsedUrl, signature, text)
	}
}

// 解析链接
func parseHref(ctx context.Context, parsedUrl *url.URL, n *html.Node, queue *models.Queue) {
	host := parsedUrl.Host
	for _, a := range n.Attr {
		if a.Key == "href" {
			href, err := url.Parse(a.Val)
			if err != nil {
				continue
			}
			// 如果主机名匹配，将链接加入队列
			if href.Host == host {
				queue.PushBack(a.Val)
				fmt.Println("新链接: ", a.Val)
			}
		}
	}
}

// 按行读取文件，返回字符串切片

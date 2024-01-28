package main

import (
	"fmt"
	"regexp"
	"testing"
	"time"
)

func TestData(t *testing.T) {
	year := 2020
	// 起始日期
	startDate := time.Date(year, time.January, 1, 0, 0, 0, 0, time.UTC)
	// 一直循环直到年份变成xx年
	for date := startDate; date.Year() == year; date = date.AddDate(0, 0, 1) {
		//fmt.Println(date.Format("Jan 02, 2006"))
		fmt.Println(date.Format("2006-01-02"))
	}
}

func TestCount(t *testing.T) {
	for i := 0; i <= 50; i++ {
		// 按照 "Compile Dependencies (i)" 的格式打印每个数字
		//fmt.Println(fmt.Sprintf("Test Dependencies (%d)", i))
		fmt.Println(fmt.Sprintf("测试依赖 Test (%d)", i))
	}
}

// BenchmarkContainsNumber 对 ContainsNumber 函数进行基准测试
func BenchmarkContainsNumber(b *testing.B) {
	msg := "snjkanJNsjka21212"
	// 在字符串中查找匹配项
	for i := 0; i < b.N; i++ {
		re := regexp.MustCompile(`\d`)
		// 调用函数并传入测试字符串
		re.MatchString(msg)
	}
}

func BenchmarkTest(b *testing.B) {
	msg := ""
	tmp := "snjkanJNsjka21212"
	for i := 0; i < 100; i++ {
		msg += tmp
	}
	fmt.Println(msg)
	b.Run("1", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = msg
		}
	})
	b.Run("2", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = []byte(msg)
		}
	})
}

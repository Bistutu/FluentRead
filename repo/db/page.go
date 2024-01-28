package db

import (
	"context"
	"errors"

	"github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"FluentRead/misc/log"
	"FluentRead/models"
)

// InsertPage 插入页面信息，如果已存在则停止操作，无论如何最终会返回对应的 pageId
func InsertPage(ctx context.Context, page *models.Page) (uint, error) {
	err := db.Create(page).Error
	if err != nil {
		// 尝试将错误断言为 *mysql.MySQLError
		var mysqlErr *mysql.MySQLError
		if ok := errors.As(err, &mysqlErr); ok && mysqlErr.Number != 1062 {
			return 0, err
		}

		// 如果是因为唯一键冲突，则尝试获取已存在记录的 ID
		var existingPage *models.Page
		if err := db.Where("link = ?", page.Link).First(&existingPage).Error; err != nil {
			log.Errorf("查询已存在的记录失败: %v", err)
			return 0, err
		}
		return existingPage.ID, nil
	}
	return page.ID, nil
}

func InsertOrUpdatePage(ctx context.Context, page *models.Page) (uint, error) {
	tx := db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "link"}},
		DoUpdates: clause.AssignmentColumns([]string{"updated_at"}),
	}).Create(page)
	return page.ID, tx.Error
}

// BatchInsertPageInfo 批量插入页面信息，如果已存在则不插入
func BatchInsertPageInfo(ctx context.Context, pages []*models.Page) error {
	// 开启事务
	return db.Transaction(func(tx *gorm.DB) error {
		for _, page := range pages {
			err := tx.Create(page).Error
			// 如果是唯一键冲突，不报错
			if !errors.Is(err, gorm.ErrDuplicatedKey) && err != nil {
				return err
			}
		}
		return nil
	})
}

// GetPageByLink 按 link 获取页面信息
func GetPageByLink(ctx context.Context, link string) (*models.Page, error) {
	var page models.Page
	return &page, db.Where("link = ?", link).First(&page).Error
}

// GetPageById 按 id 获取页面信息
func GetPageById(ctx context.Context, id uint) (*models.Page, error) {
	var page models.Page
	return &page, db.First(&page, id).Error
}

func ListPages(ctx context.Context) ([]*models.Page, error) {
	var pages []*models.Page
	return pages, db.Find(&pages).Error
}

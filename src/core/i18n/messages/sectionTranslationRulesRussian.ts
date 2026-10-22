/**
 * @file src/core/i18n/messages/sectionTranslationRulesRussian.ts
 * 文件职责：提供记住局部翻译区域的完整俄语稳定消息目录。
 * 主要内容：翻译选择器、区域规则管理、方案异常和访问提醒的全部文案，保留网站及数量插值，并以中文目录的键集合约束完整性。
 * 模块边界：仅声明界面资源，不决定区域匹配、配置保存、翻译请求或语言资源加载。
 */
import type {sectionTranslationRulesChineseMessages} from './sectionTranslationRules';

export const sectionTranslationRulesRussianMessages = {
    'sectionTranslation.rules.remember': 'Запомнить область',
    'sectionTranslation.rules.scope': 'Область действия',
    'sectionTranslation.rules.path': 'Текущая папка',
    'sectionTranslation.rules.site': 'Весь сайт',
    'sectionTranslation.rules.nextVisit': 'При следующем посещении',
    'sectionTranslation.rules.remind': 'Напомнить',
    'sectionTranslation.rules.auto': 'Автоперевод',
    'sectionTranslation.rules.confirm': 'Перевести и запомнить',
    'sectionTranslation.rules.saving': 'Сохранение…',
    'sectionTranslation.rules.saved': 'Область сохранена для следующих посещений.',
    'sectionTranslation.rules.saveFailed': 'Не удалось сохранить область. Повторите попытку.',
    'sectionTranslation.rules.unsupported': 'Не удаётся надёжно найти эту область. Измените выделение и повторите попытку.',
    'sectionTranslation.rules.limit': 'Можно сохранить не более 100 правил. Сначала удалите ненужные.',
    'sectionTranslation.rules.available': 'На странице есть сохранённые области перевода',
    'sectionTranslation.rules.translate': 'Перевести сохранённые области',
    'sectionTranslation.rules.dismiss': 'Пропустить в этот раз',
    'sectionTranslation.rules.title': 'Сохранённые области',
    'sectionTranslation.rules.description': 'Выберите и зафиксируйте область, затем отметьте «Запомнить область», чтобы переводить её автоматически или получать напоминание при следующих посещениях.',
    'sectionTranslation.rules.add': 'Добавить вручную',
    'sectionTranslation.rules.search': 'Поиск сайта или пути',
    'sectionTranslation.rules.empty': 'Выберите область на странице и отметьте «Запомнить область», чтобы управлять ею здесь.',
    'sectionTranslation.rules.noResults': 'Подходящих правил нет',
    'sectionTranslation.rules.elements': 'Пути к элементам: {count}',
    'sectionTranslation.rules.enable': 'Включить правило области для {site}',
    'sectionTranslation.rules.modeFor': 'Действие при следующем посещении {site}',
    'sectionTranslation.rules.edit': 'Изменить',
    'sectionTranslation.rules.delete': 'Удалить',
    'sectionTranslation.rules.deleteFor': 'Удалить правило области для {site}',
    'sectionTranslation.rules.website': 'Сайт или путь',
    'sectionTranslation.rules.profile': 'Профиль перевода',
    'sectionTranslation.rules.profileDefault': 'По умолчанию',
    'sectionTranslation.rules.profileMissing': 'Профиль недоступен',
    'sectionTranslation.rules.profileMissingHelp': 'Профиль перевода удалён. Измените правило и выберите другой.',
    'sectionTranslation.rules.profileNoShortcut': 'Профиль перевода области без горячей клавиши',
    'sectionTranslation.rules.selectors': 'Пути к элементам (CSS)',
    'sectionTranslation.rules.selectorsHelp': 'По одной области на строку. Разделяйте уровни открытого Shadow DOM с помощью >>>, например article-view >>> .content.',
    'sectionTranslation.rules.advanced': 'Дополнительно',
    'sectionTranslation.rules.translateCount': 'Перевести сохранённые области: {count}',
    'sectionTranslation.rules.translateFailed': 'Не удалось перевести. Повторите попытку.',
    'sectionTranslation.rules.cancel': 'Отмена',
    'sectionTranslation.rules.save': 'Сохранить правило',
    'sectionTranslation.rules.invalidSite': 'Введите корректный сайт или путь, например *.example.com или example.com/articles/.',
    'sectionTranslation.rules.invalidSelectors': 'Проверьте пути к элементам: используйте корректные CSS-селекторы, по одной области на строку.',
} as const satisfies Readonly<Record<keyof typeof sectionTranslationRulesChineseMessages, string>>;

# Shortcuts and triggers

Keyboard shortcuts and mouse actions can trigger webpage, selection, and hover translation directly.

| Action | Default |
| --- | --- |
| Translate a paragraph | Hover over it and press **Control** |
| Translate page / restore original | **Alt + T**; Alt is usually labeled Option on a Mac |
| Capture an area | Press **Shift+Z** (configurable), then drag |
| Copy the paragraph under the mouse | Point at it and press **Alt+C** (Option+C on a Mac) |
| Translate one section of a page | Click **Section** in the extension menu, or turn on the **Alt+R** shortcut (Option+R on a Mac) |
| Translate a selection | Enable selection translation, select text, and click the nearby icon |

<GuideVisual kind="shortcuts" en />

## Change a trigger

Open hover, selection, or the relevant feature settings in FluentRead. Choose a trigger or use its custom-shortcut field.

Custom page, hover, and selection shortcuts are saved when you confirm. Canceling or leaving that settings section closes the dialog and keeps the previous trigger. You can record a selection shortcut on your first visit. If an enabled extra translation profile uses the same combination, choose another before confirming.

To record a combination, hold Ctrl, Alt, or Shift and press a letter or function key. Pressing and releasing only a modifier keeps recording; confirmation stays disabled until a shortcut is ready. You can also select a recommended shortcut. Cancel keeps the previous setting.

The area shortcut lives in area translation settings, where you can pick a preset or record your own combination. See [area translation](/en/guide/area-translation).

Paragraph copy lives in **Settings → Translation → Paragraph copy**, where you can change the shortcut and choose what lands on the clipboard:

- **Match what is shown** (default): a translated paragraph is copied the way it is displayed, and untranslated text is copied as the original.
- **Original text**: always copies the page text.
- **Translation**: always copies the translation, and falls back to the original text with a notice when the paragraph is not translated yet.
- **Original and translation**: copies both blocks, ordered by your translated-text position setting.

A notice tells you what was copied and how many characters. The shortcut stays inactive in input fields and editable areas, and **Ctrl+C** keeps copying the selected text.

The section translation shortcut is off by default. Turn it on in **Settings → Translation → Section translation**, where you can pick a preset or record your own combination. Move the pointer to preview a section, then click to lock the selection. Press **↑/↓** to adjust the range and **Enter** to confirm translation or restoration, either during the preview or after locking. Press **Esc**, right-click, or press the shortcut again to exit. See [section translation](/en/guide/features#section-translation).

Selection translation can show an icon or a small dot, open directly, wait for a key, or use **Context menu only**. The context-menu-only mode shows no selection icon or dot and claims no selection shortcut. Select text, then choose **Translate selected text** in the context menu. Keep both the context menu and its selection entry enabled in **Settings → Context menu**. The reading card controls its own selection hint.

The browser’s extension shortcut page controls the extension commands listed by the browser. Paragraph and selection triggers are configured inside FluentRead.

<details class="guide-details">
<summary>A shortcut does nothing</summary>

## A shortcut does nothing

Check that translation works through the menu first. Avoid keys already used by the browser, input method, or website. Some shortcuts intentionally do not run in input fields.

Custom combinations match the character your keyboard layout produced when you recorded them, including Dvorak or AZERTY layouts. When Option on a Mac turns a key into a special symbol, the physical key is matched instead.

Try a regular webpage; browser internal pages and extension stores generally cannot be translated.

</details>

## Section shortcut profiles

In **Settings → Translation → Section translation**, add independent section shortcuts with their own service, model, target language, and display mode. A shortcut opens the section picker: hover to preview, then click to lock the selection. Once locked, use **Expand selection**, **Shrink selection** or **Reselect**, then click **Translate selected section** to confirm. You can also adjust the range with **↑/↓** and press **Enter** during the preview or after locking to translate only the selected section. Selecting a translated section with the same profile requires **Restore original** or **Enter** to confirm restoration; confirming with another profile translates it with the new settings. Press **Esc**, right-click, press the same shortcut, or use the toolbar’s close button to exit. Independent profiles work even when the primary section shortcut is off.

## Related guides

- [All guides](/en/docs/)
- [Troubleshooting](/en/guide/faq)

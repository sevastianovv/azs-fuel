# Мониторинг АЗС (Топливо, цены, очереди)

Интерактивный веб-дашборд для отслеживания доступности топлива, очередей и цен на автозаправочных станциях в городах **Казань, Москва и Санкт-Петербург**.

🌐 **Онлайн дашборд:** [sevastianovv.github.io/azs-fuel](https://sevastianovv.github.io/azs-fuel/)

## 🚀 Источники данных
* **2ГИС Топливо (2GIS Benzin API)** — цены, доступность колонок и отзывы.
* **ГдеБЕНЗ (WhereBenz API)** — пользовательские отчеты, очереди и лимиты.
* **Яндекс Карты** — актуальное состояние и наличие топлива на сетевых АЗС.

## ⚙️ Автоматическое обновление данных
Данные автоматически обновляются каждые 20 минут с помощью **GitHub Actions** (`.github/workflows/update.yml`). Скрипт `update_fuel.py` опрашивает API, склеивает данные и сохраняет их в репозиторий.

## 🌐 Настройка GitHub Pages
1. В настройках репозитория [Settings ➡️ Pages](https://github.com/sevastianovv/azs-fuel/settings/pages):
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` / `root`
   - Нажмите **Save**.
2. В настройках Actions [Settings ➡️ Actions ➡️ General](https://github.com/sevastianovv/azs-fuel/settings/actions):
   - Раздел **Workflow permissions** ➡️ Выберите **Read and write permissions** ➡️ **Save**.

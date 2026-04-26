# Timesheet Cronjob
A cronjob app written to fetch loggings data from Redbooth and store that into your own MongoDB database and then use that data to generate invoices. The script uses lots of node packages to make that happen. Initially now the app has been created with a web server functionality where you can perform different tasks by visiting certain routes and pass them certain parameters through query string to make them happen but the upcoming functionality will be to turn this into a cronjob based script where the data will be synced on a scheduled basis using the cronjob functionality of the script.

### Installation - Step 1

Run the following commands to install the script.

    git clone https://github.com/nicefellow1234/timesheet-cronjob.git
    cd timesheet-cronjob
    npm i

Copy `.env.example` to `.env` and configure `MongoDB_URI` in there:

    MONGODB_URI='mongodb://127.0.0.1:27017/dbname'

Set your Company name, address and currency symbol for invoice template:

    CURRENCY='CURRENCY_SYMBOL_HERE'
    INVOICE_COMPANY_NAME='COMPANY_NAME'
    INVOICE_COMPANY_ADDRESS='COMPANY_ADDRESS'

PDF generation can use a locally installed Chrome/Edge browser. This is optional if Puppeteer has already installed its managed browser:

    PUPPETEER_EXECUTABLE_PATH='OPTIONAL_CHROME_EXECUTABLE_PATH'

The repository keeps `.env.example` with placeholders and safe defaults. Put real local credentials and project/user defaults only in `.env`; `.env` is ignored by git.

### Installation - Step 2 - Create Redbooth API Console App

Next thing we need to do is create Redbooth API Console App so that we can get access to Redbooth API and be able to fetch data from within there.

Headover to Redbooth API Console at: https://redbooth.com/oauth2/applications/

If you do not have an existing app registered in there then headover to the following to create one: https://redbooth.com/oauth2/applications/new

![Register New Redbooth API App](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/c50286eb-3b1b-4fff-ac41-19340b7587f8)

If you already have an existing app registered in there then modify the `Return URI` to match up with our own one in `.env` i.e. **RB_REDIRECT_URI**. Keep in mind that this `Return Uri` is only for local installation, if you have deployed the script in a live server then you will need to match up with your deployed app URL.

![Created Redbooth API App](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/f3b3283f-5ef1-40d2-a250-e14e787a7202)

Once you create your Redbooth API Console app so get your `Client ID` & `Client Secret` from in there and update them in your `.env` file according next to `RB_CLIENT_ID` & `RB_CLIENT_SECRET`.

    RB_CLIENT_ID='RB_CLIENT_ID'
    RB_CLIENT_SECRET='RB_CLIENT_SECRET'
    RB_REDIRECT_URI='http://localhost:3000/authorize'
    REDBOOTH_REQUEST_INTERVAL_MS='1000'
    REDBOOTH_MAX_RETRIES='8'
    REDBOOTH_MAX_RETRY_DELAY_SECONDS='120'
    REDBOOTH_FAILED_LOGGING_RETRY_ATTEMPTS='5'

Once you do that then now it's time to fire up the app and authenticate redbooth to start fetching the data to populate our database.

Execute the following command to start the app:

    npm start

### Installation - Step 3 - Authenticate Redbooth (Get Access Token from Redbooth)

Now Headover to Redbooth API Console at: https://redbooth.com/oauth2/applications/

Open your Redbooth API Console App by clicking on `Show` button next to the app. Next click on `Authorize` button to authenticate the app and get access token.

![image](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/160b8800-dfc6-4732-8959-551bcef82f1a)


Once you click on `Authorize` button you will be forwarded to the `Return URI` for further processing.

![image](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/d10ed045-10f1-4521-b036-feb08e00b1a9)

We have completed the installation now we can move ahead to start populating the database by fetching data from redbooth.

## Running the application

To start the application, you can use one of the following commands:

- `npm start`: Starts the application in production mode.
- `npm run dev`: Starts the application in development mode with automatic restarts on file changes.

All major actions write timestamped logs to the terminal through `common/logger.js`. The dashboard also exposes a `/sync-logs` stream for viewing sync progress in the browser.

For ease of use, we have added an index page which is available at the app root URL i.e. at http://localhost:3000/ where you can perform all of the below operations from the UI.

![image](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/b66e21d0-40c8-4123-8dee-dd1622bc8f05)



Now that we have installed the script, next thing is to populate our database and fetch data from Redbooth. To make that happen we have created a route for that which will sync our data with Redbooth. We are fetching 4 types of data from Redbooth i.e. projects, tasks, users & loggings.

#### Sync Data Route: 

    http://localhost:3000/sync-data

#### Specific Data Syncing + Specific Interval Logging Data Syncing:

If you want to sync everything up from the start of the current year then visit the sync data route as given above as http://localhost/sync-data. It's crucial that you sync the whole data first time.

But if you don't want to sync the whole data every time then we have provided you different query string parameters which you can pass to the route to avoid syncing that data and you can chainup multiple string parameters as well to avoid syncing multiple types of data.

To avoid syncing `projects` & `users` (Possible other parameters are `tasks` & `loggings`):

    http://localhost:3000/sync-data?projects=0&users=0

We have also provided you the functionality to only sync loggings for a specific interval. You can use `syncDays` query string parameter to let the script only sync the specific number of days loggings.

To sync `loggings` & `tasks` for the past 2 days (We highly recommend that you use this route to sync data as quickly as possible on daily basis):

    http://localhost:3000/sync-data?projects=0&users=0&syncDays=2

Once you visit the sync data route so you will start to see progress logs in the terminal where the app is running.

![image](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/f06074ec-5635-48a5-93b9-3d0035bed767)

#### Redbooth Rate Limits and Failed Logging Retries

Redbooth can return `429 Retry later` when too many requests are made, especially while syncing `/comments` for many tasks. The sync code spaces requests out and retries failed requests with backoff. These settings can be tuned in `.env`:

    REDBOOTH_REQUEST_INTERVAL_MS='1000'
    REDBOOTH_MAX_RETRIES='8'
    REDBOOTH_MAX_RETRY_DELAY_SECONDS='120'
    REDBOOTH_FAILED_LOGGING_RETRY_ATTEMPTS='5'

During logging sync, each task's comments are fetched once during the main pass. If a task fails, it is added to a failed queue and skipped temporarily. After the main pass finishes, the failed queue is retried at the end up to `REDBOOTH_FAILED_LOGGING_RETRY_ATTEMPTS` times per task. If any tasks still fail, the terminal logs report the unresolved task count instead of claiming that everything succeeded.

#### Render Data

Once you complete syncing the data, the next step is to render the data. We have two types of rendering that happens through this route. We have provided query strings for that.

To render JSON data visit the followwing route (This will render all of the available data):

    http://localhost:3000/render-data?json=1

Since JSON data is not meaningful for normal viewing so we have also provided a view query string parameter to render data in a view where you will be able to see all of the data in a well organised manner.

To render data view visit the following route (This will render all of the available data):

    http://localhost:3000/render-data

#### Render Monthly Invoice Data

To render monthly invoice data visit the following route:

    http://localhost:3000/render-data?month=6&year=2023

If you want to render data for invoice starting from last month sunday to current invoice month last sunday then pass in an extra parameter as `invoice=1`:

    http://localhost:3000/render-data?month=6&year=2023&invoice=1

#### Generate Monthly Invoice

To generate invoice click on the `Generate Invoice` button and you will see an HTML invoice generated.

![image](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/61929dc4-7d33-478a-bcde-19eda2a48add)

Invoice can be generated with the following route (`userId` query string parameter is mandatory here):

    http://localhost:3000/generate-invoice?userId=123456&year=2023&month=6&hourlyRate=1.03&invoiceNo=120

![image](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/96c6d5a2-5ae6-481f-a0db-f264f37d0c2a)

If you want to generate a PDF out of the invoice then either click on the `Generate PDF Invoice` button or rather pass in an extra query string parameter as `generatePdf` to the invoice URL. You can also update the `hourlyRate` & `invoiceNo` value in the query string as well to update the hourly rate & invoice no in the invoice.

    http://localhost:3000/generate-invoice?userId=123456&year=2023&month=6&hourlyRate=1.03&invoiceNo=120&generatePdf=1

PDF generation uses Puppeteer. The app first checks `PUPPETEER_EXECUTABLE_PATH`, `CHROME_PATH`, `GOOGLE_CHROME_SHIM`, and common Chrome/Edge install paths before falling back to Puppeteer's browser cache. If Chrome is not installed locally and Puppeteer has not downloaded its managed browser, run:

    npx puppeteer browsers install chrome

You can also set a browser path explicitly:

    PUPPETEER_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'

#### Auto Sync + Review Invoice

The dashboard can include an `Auto Sync + Review Invoice` form. Enable it with `AUTO_INVOICE_ENABLED='1'`. When disabled, the form is hidden and `/auto-sync-invoice` returns a 404.

The form lets you select a project and user from the synced database records, set the hourly rate, and choose the invoice month/year. The project field uses a searchable Select2 multi-select in the regular sync form, while the auto invoice form uses normal project/user selects so the defaults can be changed from the UI.

Auto invoice sync fetches Redbooth task loggings for the selected project from the Monday after the previous month's last Sunday through the selected month's last Sunday, then redirects to the invoice preview with PDF generation turned off. You can review the HTML invoice first and then use the `Generate PDF Invoice` button.

Only the Redbooth comments/loggings request is restricted to the invoice date range. Task metadata may still be synced project-wide first, because comments are fetched per task and older tasks may still have comments inside the invoice period.

The form values can be overridden in the UI or configured through `.env`:

    AUTO_INVOICE_ENABLED='0'
    AUTO_INVOICE_PROJECT_NAME='PROJECT_NAME'
    AUTO_INVOICE_USER_NAME='USER_NAME'
    AUTO_INVOICE_HOURLY_RATE='HOURLY_RATE'
    AUTO_INVOICE_BASE_INVOICE_NO='BASE_INVOICE_NO'
    AUTO_INVOICE_BASE_MONTH='BASE_INVOICE_MONTH'
    AUTO_INVOICE_BASE_YEAR='BASE_INVOICE_YEAR'
    AUTO_INVOICE_SYNC_TASKS='1'

`AUTO_INVOICE_BASE_INVOICE_NO`, `AUTO_INVOICE_BASE_MONTH`, and `AUTO_INVOICE_BASE_YEAR` are used to calculate the invoice number for the selected invoice month. For example, if the base invoice number is `154` for April 2026, then May 2026 becomes `155`.

Project lookup is tolerant of spacing and punctuation differences. For example, a configured value like `CX:CE` can match a stored project named `CX: CE`.

The auto invoice route redirects to `/generate-invoice` with `generatePdf=0` and includes `invoiceProject`, so the preview only includes the selected project's loggings. The preview page's `Generate PDF Invoice` button then calls the same route with `generatePdf=1`.

#### Invoice Custom Item

If you want to add a custom item to the invoice with text and amount value then you need to pass two extra paramters to do that i.e. `customItem` & `customValue`. Multiple custom items adding is also supported just keep chaining them like given below:

Single Custom Item:

    http://localhost:3000/generate-invoice?userId=123456&year=2023&month=6&hourlyRate=1.03&invoiceNo=120&customItem=customItemHere&customValue=100

Multiple Custom Items:

    http://localhost:3000/generate-invoice?userId=123456&year=2023&month=6&hourlyRate=1.03&invoiceNo=120&customItem=customItemNo1&customValue=100&customItem=customItemNo2&customValue=200

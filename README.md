# Timesheet Cronjob
A cronjob app written to fetch loggings data from Redbooth and store that into your own MongoDB database and then use that data to generate invoices. The script uses lots of node packages to make that happen. Initially now the app has been created with a web server functionality where you can perform different tasks by visiting certain routes and pass them certain parameters through query string to make them happen but the upcoming functionality will be to turn this into a cronjob based script where the data will be synced on a scheduled basis using the cronjob functionality of the script.

### Installation - Step 1

Run the following commands to install the script.

    git clone https://github.com/nicefellow1234/timesheet-cronjob.git
    cd timesheet-cronjob
    npm i

Rename `.env.sample` to `.env` and configure `MongoDB_URI` in there:

    MONGODB_URI='mongodb://127.0.0.1:27017/dbname'

Set your Company name, address and currency symbol for invoice template:

    CURRENCY='CURRENCY_SYMBOL_HERE'
    INVOICE_COMPANY_NAME='COMPANY_NAME'
    INVOICE_COMPANY_ADDRESS='COMPANY_ADDRESS'

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

Once you do that then now it's time to fire up the app and authenticate redbooth to start fetching the data to populate our database. 

Execute the following command to start the app:

    node app.js

### Installation - Step 3 - Authenticate Redbooth (Get Access Token from Redbooth)

Now Headover to Redbooth API Console at: https://redbooth.com/oauth2/applications/

Open your Redbooth API Console App by clicking on `Show` button next to the app. Next click on `Authorize` button to authenticate the app and get access token.

![image](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/160b8800-dfc6-4732-8959-551bcef82f1a)


Once you click on `Authorize` button you will be forwarded to the `Return URI` for further processing.

![image](https://github.com/nicefellow1234/timesheet-cronjob/assets/10282608/d10ed045-10f1-4521-b036-feb08e00b1a9)

We have completed the installation now we can move ahead to start populating the database by fetching data from redbooth.

## Usage

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


var express = require("express");
var app = express();
const axios = require('axios');
const OrderInfoRequest = require("shipday/integration/order/request/order.info.request");
const PaymentMethod = require("shipday/integration/order/types/payment.method");
const CardType = require("shipday/integration/order/types/card.type");
const OrderItem = require("shipday/integration/order/request/order.item");
const Shipday = require("shipday/integration");
const bodyParser = require('body-parser');
const dateTimeHandler = require('./utils/dateTimeHandler')
const moment = require('moment-timezone');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
require('dotenv').config()
const mondaySdk = require('monday-sdk-js');
const monday = mondaySdk();
var cron = require('node-cron');
const apiToken = process.env.MONDAY_API_KEY;
monday.setToken(apiToken)

app.get("/", function (req, res) {
  res.send('Shipday Server running here')
});


// cron.schedule('36 20 * * *', () => {
  // const now = moment().utc().format('YYYY-MM-DD');
  // console.log(`Running cron job at: ${now} (EST)`);
  // console.log('Running a job at 00:01 AM in America/New York timezone');
  // let addRowQuery = 
  // `
  //   query {
  //     items_page_by_column_values (
  //         limit: 50,
  //         board_id: 6343774897,
  //         columns: [
  //           { column_id: "dup__of_delivery_time3__1", column_values: ["2024-06-02"] },
  //           { column_id: "status", column_values: ["Pending"] }
  //       ]
  //     ) {
  //         items {
  //             id
  //             name
  //         }
  //     }
  // }
  // `
  // monday.api(addRowQuery)
  // .then(response => {
  //   console.log('Webhook sent to Zapier:', response.data.items_page_by_column_values);
  //   let results = response.data.items_page_by_column_values.items
  //   results.map((item) => {
  //     console.log(item)
  //     let newData = getOrderDetails(item.name)
  //   })
  // }).catch((err)=>{
  //   console.error('Error sending webhook to Zapier:', err);
  // })
// }, {
//   scheduled: true,
//   // timezone: "America/New_York"
//   timezone: "UTC"
// });

async function getOrderDetails(jobId) {
  const url = 'https://api.yelo.red/open/orders/getDetails';
  const payload = {
      api_key: process.env.YELO_API_KEY,
      job_id: jobId
  };

  try {
      const response = await fetch(url, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
      });

      if (!response.ok) {
          throw new Error(`Error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      console.log(data.data[0])
      await sendOrderToShipday(data.data[0])
      return data;
  } catch (error) {
      console.error('Error fetching order details:', error);
  }
}

const sendOrderToShipday = async(payload) => {
  if (!payload) {
    console.log('Payload not valid')
    return false
  }

  let storeApi = `SHIPDAY_API_${payload.merchant_id}`;

  const shipdayClient = new Shipday(process.env[storeApi] || process.env.MAIN_SHIPDAY_API, 10000);

  let deliveryTime = payload.job_delivery_datetime;
  if (!deliveryTime) {
    console.error("Invalid delivery time format.");
    return false
  }
  let pickupTime = payload.job_pickup_datetime;
  if (!pickupTime) {
    console.error("Invalid pickup time format.");
    return false
  }

  const date = new Date(payload.job_time);
  const timestamp = date.getTime();
  console.log(timestamp);
  let latitude_timezone = payload.task_type == 1 ? payload.job_pickup_latitude : payload.job_latitude;
  let longitude_timezone = payload.task_type == 1 ? payload.job_pickup_longitude : payload.job_longitude;
  let timezoneOffset = await dateTimeHandler.getTimeZoneFromCoordinates(latitude_timezone, longitude_timezone, timestamp)
  // let timezoneOffset = await dateTimeHandler.getTimeZoneFromCoordinates(payload.job_pickup_latitude, payload.job_pickup_longitude, timestamp)

  let GMTOFFSET= dateTimeHandler.applyOffset(pickupTime, timezoneOffset)

  pickupTime = new Date(pickupTime + ` ${GMTOFFSET}`);
  deliveryTime = new Date(deliveryTime + ` ${GMTOFFSET}`);
  console.log(pickupTime)
  console.log(deliveryTime)

  let validStore = await validShipdayStore(payload.merchant_id+"")
  if(!validStore){
    console.log("Not a valid store for shipday order")
    return
  }

  const orderInfoRequest = new OrderInfoRequest(
    payload.job_id,
    payload.merchant_address === payload.job_address ? payload.merchant_name : payload.customer_username,
    payload.job_address,
    payload.merchant_address === payload.job_address ? payload.merchant_email : payload.customer_email,
    payload.merchant_address === payload.job_address ? payload.merchant_phone_number : payload.customer_phone,
    payload.merchant_address === payload.job_address ? payload.customer_username : payload.merchant_name,
    payload.job_pickup_address,
  );

  orderInfoRequest.setRestaurantPhoneNumber(payload.merchant_address === payload.job_address ? payload.job_pickup_phone : payload.merchant_phone_number);
  orderInfoRequest.setExpectedDeliveryDate(extractDate(deliveryTime));
  orderInfoRequest.setExpectedDeliveryTime(extractTime(deliveryTime));
  orderInfoRequest.setExpectedPickupTime(extractTime(pickupTime));
  orderInfoRequest.setPickupLatLong(payload.job_pickup_latitude, payload.job_pickup_longitude);
  orderInfoRequest.setDeliveryLatLong(payload.job_latitude, payload.job_longitude);
  
  if(payload.tip !== 0){
    orderInfoRequest.setTips(payload.tip);
  }
  if(payload.tax !== 0){
    orderInfoRequest.setTax(payload.tax);
  }
  let new_desc = setInstructionTemplate(payload)
  if(new_desc){
    orderInfoRequest.setDeliveryInstruction(
        new_desc
        );
  }
  orderInfoRequest.setTotalOrderCost(payload.total_order_amount);
  const paymentOption = PaymentMethod.CREDIT_CARD;
  const cardType = CardType.AMEX;

  orderInfoRequest.setPaymentMethod(paymentOption);
  orderInfoRequest.setCreditCardType(cardType);

  const itemsArr = [];

  payload.orderDetails?.forEach(detail => {
    const productName = detail?.product?.product_name;
    const price = detail?.product?.unit_price;
    const quantity = detail?.product?.quantity;
    
    if (productName && price && quantity) {
      itemsArr.push(new OrderItem(productName, price, quantity));
    } else {
      console.error("Invalid order detail format:", detail);
    }
  });

  orderInfoRequest.setOrderItems(itemsArr);
  console.log('done')
  try {
    const response = await shipdayClient.orderService.insertOrder(orderInfoRequest);
    console.log(response)
    console.log("Shipway Order Created");
    return true;
  } catch (error) {
    console.error("Error creating Shipway order:", error);
    return false;
  }
  // await shipdayClient.orderService
  //   .insertOrder(orderInfoRequest)
  //   .then((response) => {
  //     console.log("Shipway Order Created");
  //     return true
  //   })
  //   .catch((error) => {
  //     console.error("Error creating Shipway order:", error);
  //     return false
  //   });
}

app.post("/move-order-to-shipday", async function (req, res) {
  console.log("moving order");
  console.log(req.body);
  let payload = req.body;
  if (!payload) {
    return res.status(400).send("Bad request: No payload provided.");
  }

  let validStore = await validShipdayStore(payload.merchant_id+"")
  if(!validStore){
    console.log("Not a valid store for shipday order")
    res.send("Not a valid store for shipday order")
    return
  }

  let deliveryTime = payload.job_delivery_datetime;
  if (!deliveryTime) {
    console.error("Invalid delivery time format.");
    return res.status(400).send("Bad request: Invalid delivery time format.");
  }
  let pickupTime = payload.job_pickup_datetime;
  if (!pickupTime) {
    console.error("Invalid pickup time format.");
    return res.status(400).send("Bad request: Invalid pickup time format.");
  }

  const date = new Date(req.body.job_time);
  const timestamp = date.getTime();
  console.log(timestamp);
  let latitude_timezone = payload.task_type == 1 ? payload.job_pickup_latitude : payload.job_latitude;
  let longitude_timezone = payload.task_type == 1 ? payload.job_pickup_longitude : payload.job_longitude;
  let timezoneOffset = await dateTimeHandler.getTimeZoneFromCoordinates(latitude_timezone, longitude_timezone, timestamp)

  let GMTOFFSET= dateTimeHandler.applyOffset(pickupTime, timezoneOffset)

  pickupTime = new Date(pickupTime + ` ${GMTOFFSET}`);
  // res.send('test')
  // return
  deliveryTime = new Date(deliveryTime + ` ${GMTOFFSET}`);
  console.log(pickupTime)
  console.log(deliveryTime)
  // unique
  const addRowQuery = `
    mutation {
      create_item (
          board_id: 6343774897,
          group_id: "topics",
          item_name: "${payload.job_id}",
          column_values: "{\\"status\\": \\"Pending\\", \\"status_1__1\\": \\"${payload.merchant_id == "1634421" ? "VLO" : "Corporate"}\\", \\"text7\\": \\"${payload.task_type == 1 ? "Pickup" : "Delivery"}\\", \\"text\\": \\"${payload.merchant_name}\\", \\"text5\\": \\"${payload.customer_username}\\", \\"date4\\": {\\"date\\":\\"${extractDate(deliveryTime)}\\", \\"time\\":\\"${extractTime(deliveryTime)}\\"}, \\"dup__of_delivery_time3__1\\": {\\"date\\":\\"${extractDate(pickupTime)}\\", \\"time\\":\\"${extractTime(pickupTime)}\\"}, \\"location\\": {\\"lat\\":\\"1\\", \\"lng\\":\\"1\\", \\"address\\":\\"${payload.job_pickup_address}\\"}, \\"location3\\": {\\"lat\\":\\"1\\", \\"lng\\":\\"1\\", \\"address\\":\\"${payload.job_address}\\"}}"
          ) {
          id
      }
  }
  `;

  monday.api(addRowQuery)
  .then(response => {
    console.log('Webhook sent to Zapier:', response.data);
  }).catch((err)=>{
    console.error('Error sending webhook to Zapier:', err);
  })
  // // unique

  // console.log('pickup time is ', pickupTime)
  // let utc_date = new Date()
  // console.log("date1 is ", utc_date)
  // console.log(utc_date.getUTCDate())
  // if(utc_date.getUTCDate() == pickupTime.getUTCDate()){
  //   console.log('pickup time is today')
  // }else{
  //   console.log('will be moved to shipday on pickup date')
  //   res.send('will be moved to shipday on pickup date')
  //   return
  // }

  const shipwayResponse = await sendOrderToShipday(payload)
  if(shipwayResponse){
    res.send("Shipway Order Created");
  }else{
    res.status(500).send("Internal Server Error");
  }
  return
  // const orderInfoRequest = new OrderInfoRequest(
  //   payload.job_id,
  //   payload.merchant_address === payload.job_address ? payload.merchant_name : payload.customer_username,
  //   payload.job_address,
  //   payload.merchant_address === payload.job_address ? payload.merchant_email : payload.customer_email,
  //   payload.merchant_address === payload.job_address ? payload.merchant_phone_number : payload.customer_phone,
  //   payload.merchant_address === payload.job_address ? payload.customer_username : payload.merchant_name,
  //   payload.job_pickup_address,
  // );

  // orderInfoRequest.setRestaurantPhoneNumber(payload.merchant_address === payload.job_address ? payload.job_pickup_phone : payload.merchant_phone_number);
  // orderInfoRequest.setExpectedDeliveryDate(extractDate(deliveryTime));
  // orderInfoRequest.setExpectedDeliveryTime(extractTime(deliveryTime));
  // orderInfoRequest.setExpectedPickupTime(extractTime(pickupTime));
  // orderInfoRequest.setPickupLatLong(payload.job_pickup_latitude, payload.job_pickup_longitude);
  // orderInfoRequest.setDeliveryLatLong(payload.job_latitude, payload.job_longitude);
  
  // if(payload.tip !== 0){
  //   orderInfoRequest.setTips(payload.tip);
  // }
  // if(payload.tax !== 0){
  //   orderInfoRequest.setTax(payload.tax);
  // }
  // let new_desc = setInstructionTemplate(payload)
  // if(new_desc){
  //   orderInfoRequest.setDeliveryInstruction(
  //       new_desc
  //       );
  // }
  // orderInfoRequest.setTotalOrderCost(payload.total_order_amount);
  // const paymentOption = PaymentMethod.CREDIT_CARD;
  // const cardType = CardType.AMEX;

  // orderInfoRequest.setPaymentMethod(paymentOption);
  // orderInfoRequest.setCreditCardType(cardType);

  // const itemsArr = [];

  // payload.orderDetails?.forEach(detail => {
  //   const productName = detail?.product?.product_name;
  //   const price = detail?.product?.unit_price;
  //   const quantity = detail?.product?.quantity;
    
  //   if (productName && price && quantity) {
  //     itemsArr.push(new OrderItem(productName, price, quantity));
  //   } else {
  //     console.error("Invalid order detail format:", detail);
  //   }
  // });
  // orderInfoRequest.setOrderItems(itemsArr);
  // shipdayClient.orderService
  //   .insertOrder(orderInfoRequest)
  //   .then((response) => {
  //     console.log(response);
  //     res.send("Shipway Order Created");
  //   })
  //   .catch((error) => {
  //     console.error("Error creating Shipway order:", error);
  //     res.status(500).send("Internal Server Error");
  //   });
});

app.post("/edit-order-on-Monday", async function(req, res) {
  console.log("updating order");
  console.log(req.body);
  let payload = req.body;
  if (!payload || !payload.job_id) {
    return res.status(400).send('Bad request: Missing job ID in payload.');
  }

  const testQuery = 
  `query {
    items_page_by_column_values (limit: 50, board_id: 6343774897, columns: [{column_id: "name", column_values: ["${payload.job_id}"]}]) {
      items {
        id
      }
    }
  }`
  monday.api(testQuery)
  .then(response => {
    const itemId = response?.data?.items_page_by_column_values?.items[0]?.id
    console.log(response)
    if(itemId){
      payload.columnId = itemId;
      console.log('coulmn id is', payload.columnId)

      const addRowQuery = `
        mutation {
        change_column_value(item_id: ${itemId}, board_id: 6343774897, column_id: "status", value: "{\\"label\\": \\"${payload.job_status == 13 ? "Completed" : "Cancelled"}\\"}") {
          id
        }
      }
      `;

      monday.api(addRowQuery)
      .then(response => {
        console.log('Webhook sent to Zapier:');
        res.sendStatus(200);
      })
      .catch(error => {
        console.error('Error sending webhook to Zapier:', error);
        res.sendStatus(500);
      });
      return;
    } else {
      console.error('Item not found on Monday board');
      res.status(404).send('Item not found on Monday board');
    }
  })
  .catch(error => {
    console.error('Error updating item:', error);
    res.status(500).send('Internal Server Error');
  });
})

function extractDate(pacificDate){
  const year = pacificDate.getUTCFullYear();
  const month = String(pacificDate.getUTCMonth() + 1).padStart(2, '0'); 
  const day = String(pacificDate.getUTCDate()).padStart(2, '0');

  const date = `${year}-${month}-${day}`;
  console.log('date is', date)
  return date
}

function extractTime(pacificDate){
  const hours = String(pacificDate.getUTCHours()).padStart(2, '0');
  const minutes = String(pacificDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(pacificDate.getUTCSeconds()).padStart(2, '0');
  const time = `${hours}:${minutes}:${seconds}`;
  console.log('time is', time)
  return time
}

async function validShipdayStore(storeId){
  const storeQuery = `
    query {
      boards(ids: [6337102472]) {
        name
        items_page  {
          items {
            id
            name
            column_values(ids: ["text"]) {
              id
              text
            }
          }
        }
      }
    }
  `;

  try {
    const response = await monday.api(storeQuery);
    const textValues = response.data.boards[0].items_page.items.map(item => {
      // console.log(item.column_values)
      const textColumn = item.column_values.find(col => col.id === 'text');
      return textColumn ? textColumn.text : null;
    }).filter(text => text !== null && text !== '');

    const validStores = textValues;
    // ID For Marwan VLO
    validStores.push('1634421');
    console.log(validStores)
    console.log(storeId)
    return validStores.includes(storeId);
  } catch (err) {
    console.error('Error sending webhook to Zapier:', err);
    return false;
  }
}


function setInstructionTemplate(payload){
  let instructions = ''
  if(payload.task_type == 1){
    // Apt 5D
    instructions = `
      For Customer - Pickup
      Note below:
      1. Call Customer 10 min before arrival
      2. Greet with “Aloha, this is (Your Name) with Aloha Laundry Life.
      3. Pick up the following items:
      `;

      payload.orderDetails?.forEach(detail => {
          const productName = detail?.product?.product_name;
          const quantity = detail?.product?.quantity;
          instructions += `---\t${quantity} ${productName}\n`;
      });

      instructions += `
      *For Laundromat - Dropoff/Delivery
      1. Walk into ${payload?.merchant_name}
      2. Let them know you are with Aloha Laundry Life
      3. Drop off Order for ${payload.customer_username}
      `;
  }else{
    instructions = 
    `
      Pikcup at Laundromat take back to cusomter:
      For Laundromat - Pickup
      1. Walk Into ${payload?.merchant_name}
      2. Let them know you are with Aloha Laundry Life
      3. Order for ${payload.customer_username}
      4. Pick up the following items:
      `;
      payload.orderDetails?.forEach(detail => {
        const productName = detail?.product?.product_name;
        const quantity = detail?.product?.quantity;
        instructions += `---\t${quantity} ${productName}\n`;
    });
      instructions += `
      *For Customer - Delivery
      Adrress
      1. Call Customer 10 min before arrival
      2. Greet with “Aloha, this is (Your Name) with Aloha Laundry Life.
      3. Drop off (#) bags of laundry
    `
  }
  return instructions
}
const port = process.env.PORT || 3000; 

app.listen(port, function () {
  console.log("Example app listening on port " + port + "!");
});

module.exports = app;

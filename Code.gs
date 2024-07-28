function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index');
}

function uploadFile(formData, emailAddress) {
  try {
    var folderName = "Receipts";
    var sheetId = "1mJg9uEDGsSEGklJ8FaNI2fpY-0jP1b75sDWeuDG305I";

    // Decode base64 data
    var decodedData = Utilities.base64Decode(formData);
    var blob = Utilities.newBlob(decodedData, "image/jpeg", "receipt.jpg");

    // Define folder
    var folder = DriveApp.getFoldersByName(folderName).next();
    var file = folder.createFile(blob);
    var fileId = file.getId();
    var fileName = blob.getName();

    clearSheet(sheetId);

    // Perform OCR
    var ocrResult = performOCR(fileId, fileName, sheetId);
    

    // Write items to sheet and get sheet ID
    var sheetId2 = writeItemsToSheet(ocrResult, fileName, emailAddress);

    return { status: 'success', message: 'Receipt uploaded and processed successfully', sheetId: sheetId2 };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function clearSheet(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheets()[0]; // Get the first sheet
  var range = sheet.getDataRange(); // Get the entire data range
  range.clear(); // Clear all content in the sheet
}

function performOCR(fileId, fileName, sheetId) {
  var resource = {
    title: fileName,
    mimeType: "image/jpeg"
  };

  // Perform OCR on the image file
  var ocrFile = Drive.Files.insert(resource, DriveApp.getFileById(fileId).getBlob(), { ocr: true });
  var docId = ocrFile.id;

  // Open the Google Doc and get the OCR text
  var doc = DocumentApp.openById(docId);
  var body = doc.getBody().getText();

  // Append OCR text to Google Sheet
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getActiveSheet();
  sheet.appendRow([fileName, body]);

  return body;
}

function parseReceipt(receiptText) {
  if (!receiptText || typeof receiptText !== 'string') {
    Logger.log('Invalid receipt text');
    return [];
  }

  const items = [];
  const lines = receiptText.split('\n');
  let currentItem = null;
  let currentQuantity = 1; // Default quantity
  const excludeKeywords = ["change", "cash", "invoice", "date", "previous balance", "amount used", "available balance", "for here", "mobile app", "ref no", "your next drink", "free wifi code", "service tax id", "maybank qr", "powered by feedme smart", "this is an official receipt", "qty", "we hope to see you again soon!", "thank you for visiting us.", "enjoyed with us.", "sttl","code",  ]; // Keywords to exclude

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if the line should be excluded
    const isExcluded = excludeKeywords.some(keyword => line.toLowerCase().includes(keyword));
    if (isExcluded) {
      continue;
    }

    // Check if the line is a quantity
    const quantityMatch = line.match(/^\d{1,2}$/);
    if (quantityMatch) {
      currentQuantity = parseInt(quantityMatch[0], 10);
      continue;
    }

    // Check if the line is a price
    //const priceMatch = line.match(/^(\d+\.\d{2})$/);
    const priceMatch = line.match(/^(-?\d+\.\d{2})$/);
    if (priceMatch) {
      // Check the previous line
      if (i > 0) {
        const previousLine = lines[i - 1].trim();
        const previousLineExcluded = excludeKeywords.some(keyword => previousLine.toLowerCase().includes(keyword));
        if (previousLineExcluded) {
          continue; // Skip this price line if the previous line is excluded
        }
      }

      const itemPrice = parseFloat(priceMatch[1]);
      if (currentItem) {
        items.push({
          itemName: currentItem,
          itemQuantity: currentQuantity,
          itemPrice: itemPrice
        });
        currentItem = null; // Reset current item
        currentQuantity = 1; // Reset quantity to default
      } else {
        // Check previous lines for item name if currentItem is null
        for (let j = i - 1; j >= 0; j--) {
          let previousLine = lines[j].trim();
          const previousLineExcluded = excludeKeywords.some(keyword => previousLine.toLowerCase().includes(keyword));
          if (previousLineExcluded) {
            continue; // Skip excluded words
          }
          currentItem = previousLine;
          break;
        }
        if (currentItem) {
          items.push({
            itemName: currentItem,
            itemQuantity: currentQuantity,
            itemPrice: itemPrice
          });
          currentItem = null;
          currentQuantity = 1;
        }
      }
      continue;
    }

    // If it's not a quantity or a price, it must be an item name
    if (!quantityMatch && !priceMatch) {
      currentItem = line;
    }
  }

  return items;
}

function writeItemsToSheet(ocrResult, fileName, emailAddress) {
  const receiptText = ocrResult;

  const items = parseReceipt(receiptText);

  // Open the Google Sheet by ID and select the first sheet
  var sheetId2 = "1Ugkx_GYOddIGbybRxupCww8UUEURC8zI9pz2G0x1DkI";
  const sheet = SpreadsheetApp.openById(sheetId2).getSheets()[0];

  clearSheet(sheetId2);

  // Write headers
  sheet.getRange('A1').setValue('Item');
  sheet.getRange('B1').setValue('Quantity');
  sheet.getRange('C1').setValue('Price');

  // Write items to the sheet
  items.forEach((item, index) => {
    sheet.getRange(index + 2, 1).setValue(item.itemName);
    sheet.getRange(index + 2, 2).setValue(item.itemQuantity);
    sheet.getRange(index + 2, 3).setValue(item.itemPrice);
  });

  // Send email with OCR result
  sendEmail(emailAddress, fileName, sheetId2);

  return sheetId2;
}

function sendEmail(emailAddress, fileName, sheetId2) {
  var subject = "Your receipt for " + fileName;

  // Open the Google Sheet by ID and select the first sheet
  const sheet = SpreadsheetApp.openById(sheetId2).getSheets()[0];

  // Get the parsed items from the sheet
  var range = sheet.getRange('A2:C' + sheet.getLastRow());
  var values = range.getValues();

  // Prepare email body with parsed items
  var body = "Here are the items from your receipt:\n\n";

  values.forEach(function (row) {
    try {
      var itemName = row[0];
      var itemQuantity = row[1];
      var itemPrice = row[2];

      // Skip items that are not strings
      if (typeof itemName !== 'string') {
        return; // Skip this item
      }

      itemName = itemName.padEnd(30, ' ');  // Adjust padding as needed
      itemQuantity = itemQuantity.toString().padEnd(8, ' ');
      itemPrice = itemPrice.toFixed(2).padEnd(8, ' ');

      body += `${itemName}\t${itemQuantity}\t${itemPrice}\n`;
    } catch (e) {
      Logger.log('Error processing row: ' + row + ', Error: ' + e);
      // Skip the row if an error occurs
    }
  });

  // Send email
  MailApp.sendEmail(emailAddress, subject, body);
}

// Function to get receipt data for display on web page
function getReceiptData() {
  var sheetId = "1Ugkx_GYOddIGbybRxupCww8UUEURC8zI9pz2G0x1DkI";
  var sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
  var range = sheet.getRange('A2:C' + sheet.getLastRow());
  var values = range.getValues();
  return values;
}

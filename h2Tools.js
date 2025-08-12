(async() => {
	// Required modules
	const fs = require('fs');
	const prompt = require('prompt-sync')();
	const utilFunctions = require('./utils/UtilFunctions');
	const { FileParser } = require('./utils/fileParser');

	// Required lookup files
	let slotNumLookup = JSON.parse(fs.readFileSync('lookupFiles/25_slotNumLookup.json', 'utf8'));
	let slotsLookup = JSON.parse(fs.readFileSync('lookupFiles/25_slotsLookup.json', 'utf8'));
	const fieldLookup = JSON.parse(fs.readFileSync('lookupFiles/fieldLookup.json', 'utf8'));
	const enumLookup = JSON.parse(fs.readFileSync('lookupFiles/enumLookup.json', 'utf8'));
	const m25to26Lookup = utilFunctions.normalizeKeys(JSON.parse(fs.readFileSync('lookupFiles/25to26Lookup.json', 'utf8')));
	const bodyTypeLookup = JSON.parse(fs.readFileSync('lookupFiles/bodyTypeLookup.json', 'utf8'));
	const m25SlotNumLookup = utilFunctions.normalizeKeys(JSON.parse(fs.readFileSync('lookupFiles/25_slotNumLookup.json', 'utf8')));

	// Reverse 25 to 26 lookup to get 26 to 25 lookup
	const m26to25Lookup = {};
	for (const [key, value] of Object.entries(m25to26Lookup)) {
		m26to25Lookup[value.toLowerCase()] = key;
	}

	// Version number constant
	const VERSION_STRING = "v2.1";
	let currentGameYear = 25;

	// Field type constants
	const FIELD_TYPE_INT = 0;
	const FIELD_TYPE_STRING = 1;
	const FIELD_TYPE_ARRAY = 4;
	const FIELD_TYPE_FLOAT = 10;

	// Function to get the current game year
	function getGameYear()
	{
		let gameYear;
		do
		{
			console.log("Is this for Madden 25 or 26?");
			gameYear = parseInt(prompt().trim());

			if(gameYear !== 25 && gameYear !== 26)
			{
				console.log("Invalid input. Please enter 25 or 26.");
			}
		}
		while(gameYear !== 25 && gameYear !== 26);

		currentGameYear = gameYear;

		slotNumLookup = JSON.parse(fs.readFileSync(`lookupFiles/${gameYear}_slotNumLookup.json`, 'utf8'));
		slotsLookup = JSON.parse(fs.readFileSync(`lookupFiles/${gameYear}_slotsLookup.json`, 'utf8'));
	}

	// Function to read records from an H2 file
	async function readRecords()
	{
		getGameYear();
		
		// Set up data buffer
		console.log("\nEnter the path to the H2 archive file: ");
		const visualsPath = prompt().trim().replace(/['"]/g, '');
		let fileData = fs.readFileSync(visualsPath);

		let parser = new FileParser(fileData);

		// Read the start of the file
		if(currentGameYear >= 26)
		{
			parser.readBytes(6);
		}

		const tableBytes = parser.readBytes(3);
		const tableName = utilFunctions.getUncompressedTextFromSixBitCompression(tableBytes);
		const type = parser.readByte().readUInt8(0);
		const unkBytes = parser.readBytes(2);
		const recordCount = utilFunctions.readModifiedLebEncodedNumber(parser);

		
		console.log("\nEnter the path to the folder where you want to save the records: ");
		let recordsPath = prompt().trim().replace(/['"]/g, '');
		
		if(recordsPath.endsWith("/"))
		{
			recordsPath = recordsPath.slice(0, -1);
		}
				
		console.log(`\nTable Name: ${tableName}`);
		console.log(`Type: ${type}`);
		console.log(`Record count: ${recordCount}`);

		console.log("\nNow working on decompressing the records...");

		// If the records folder doesn't exist, create it
		if(!fs.existsSync(recordsPath))
		{
			fs.mkdirSync(recordsPath);
		}

		// Read each record
		for(let i = 0; i < recordCount; i++)
		{
			const recordKey = utilFunctions.readModifiedLebEncodedNumber(parser);
			const recordByteSize = utilFunctions.readModifiedLebEncodedNumber(parser);

			const recordData = parser.readBytes(recordByteSize);
			const decompressedData = utilFunctions.decompressBuffer(recordData);

			fs.writeFileSync(recordsPath + "/" + recordKey + ".dat", decompressedData);
		}

		console.log(`\nRecords decompressed and saved to ${recordsPath}!`);
	}

	// Function to write records to an H2 file
	async function writeRecords(recordsObject = null, outputName = null, tableName = "PLEX")
	{
		if(!recordsObject)
		{
			getGameYear();

			if(currentGameYear >= 26)
			{
				tableName = "BLBM";
			}
			
			// Enter the path to the records folder
			console.log("\nEnter the path to the folder containing the records:");
			let recordsPath = prompt().trim().replace(/['"]/g, '');

			recordsObject = {};

			if(recordsPath.endsWith("/"))
			{
				recordsPath = recordsPath.slice(0, -1);
			}

			if(!fs.existsSync(recordsPath))
			{
				console.log("The specified path does not exist.");
				return;
			}

			// Enumerate the records in the records folder
			const files = fs.readdirSync(recordsPath);

			// Sort the files in ascending order
			files.sort((a, b) => parseInt(a.split(".")[0]) - parseInt(b.split(".")[0]));

			for (const file of files)
			{
				const recordData = fs.readFileSync(recordsPath + "/" + file);
				const recordKey = parseInt(file.split(".")[0]);
				recordsObject[recordKey] = recordData;
			}

		}

		if(!outputName)
		{
			// Enter the name of the output file
			console.log("\nEnter the name of the output file (without extension):");
			outputName = prompt().trim().replace(/['"]/g, '');
		}
		
		const newRecordCount = utilFunctions.writeModifiedLebEncodedNumber(Object.values(recordsObject).length);

		const unkBytes = Buffer.from([0x00, 0x02]);

		const tableBytes = Buffer.from(utilFunctions.compress6BitString(tableName));

		// Write the beginning of the file
		let headerBuffer = Buffer.alloc(6 + newRecordCount.length);
		tableBytes.copy(headerBuffer, 0);
		headerBuffer[3] = 0x05;
		unkBytes.copy(headerBuffer, 4);
		newRecordCount.copy(headerBuffer, 6);

		if(currentGameYear >= 26)
		{
			const extendedHeaderBuf = Buffer.from([0x8A, 0xCB, 0xE2, 0x04, 0x03, 0x01]);
			headerBuffer = Buffer.concat([extendedHeaderBuf, headerBuffer]);
		}

		let recordBufferArray = [];

		let keysList = Object.keys(recordsObject).sort((a, b) => parseInt(a) - parseInt(b));

		// Iterate through each record file
		for(const key of keysList)
		{
			const recordData = recordsObject[key];

			const compressedData = utilFunctions.compressBuffer(recordData);

			const recordKeyBuffer = utilFunctions.writeModifiedLebEncodedNumber(key);
			const recordSizeBuffer = utilFunctions.writeModifiedLebEncodedNumber(compressedData.length);

			const recordBuffer = Buffer.concat([recordKeyBuffer, recordSizeBuffer, compressedData]);

			recordBufferArray.push(recordBuffer);
		}

		for(const recordBuffer of recordBufferArray)
		{
			headerBuffer = Buffer.concat([headerBuffer, recordBuffer]);
		}

		if(currentGameYear >= 26)
		{
			const trailingBuf = Buffer.from([0xD3, 0x29, 0x66, 0x00, 0x90, 0xB1, 0x8A, 0x94, 0x0B, 0x00]);
			headerBuffer = Buffer.concat([headerBuffer, trailingBuf]);
		}

		fs.writeFileSync(outputName + ".H2", headerBuffer);

		console.log(`\nRecords written to ${outputName}.H2!`);

	}

	// Function to write a CHVI record based on a JSON object
	function writeChviRecord(objectData)
	{
		const recordBufferArray = [];

		let keys = Object.keys(objectData);
		let order = [];

		// Hack to ensure everything is ordered correctly
		if(keys.includes("slotType"))
		{
			if(keys.includes("blends"))
			{
				order.push("blends")
				if(keys.includes("itemAssetName"))
				{
					order.push("itemAssetName");
				}
			}
			else if(keys.includes("itemAssetName"))
			{
				order.push("itemAssetName");
			}

			order.push("slotType");

			keys = order;
		}
		else if(keys.includes("loadouts"))
		{
			keys = ["assetName", "bodyType", "firstName", "jerseyNumber", "lastName", "containerId", "genericHeadName", "genericHead", "heightInches", "loadouts", "skinTone", "skinToneScale", "weightPounds"];
		}

		for(let key of keys)
		{		
			if(!fieldLookup.hasOwnProperty(key) || !objectData.hasOwnProperty(key))
			{
				continue;
			}

			
			let field = fieldLookup[key];

			if(objectData[key] === "GearOnly")
			{
				field = {
					key: "LDTY",
					type: FIELD_TYPE_INT
				}

				key = "loadoutType";
			}

			let valueToWrite = objectData[key];

			if(field.key === "SLOT")
			{
				let lowerCaseSlotLookup = utilFunctions.normalizeKeys(slotNumLookup);
				valueToWrite = lowerCaseSlotLookup[valueToWrite.toLowerCase()];

			}
			else if(field.key === "USKT")
			{
				recordBufferArray.push(...utilFunctions.compress6BitString(field.key));
				recordBufferArray.push(field.type);
				recordBufferArray.push(0xC0, 0xFE, 0xFB, 0x07);
				continue;
			}
			else if(field.key === "GENR")
			{
				// Extra unknown field
				recordBufferArray.push(0x8E, 0xFB, 0x62, 0x03, 0x00);
			}
			else if(field.type === FIELD_TYPE_INT && typeof valueToWrite === "string")
			{
				if(enumLookup.hasOwnProperty(key) && enumLookup[key].hasOwnProperty(valueToWrite))
				{
					valueToWrite = enumLookup[key][valueToWrite];
				}
				else
				{
					valueToWrite = parseInt(valueToWrite);
				}
			}

			recordBufferArray.push(...utilFunctions.compress6BitString(field.key));
			recordBufferArray.push(field.type);

			if(field.type === FIELD_TYPE_INT)
			{
				let numberBytes = [...utilFunctions.writeModifiedLebEncodedNumber(valueToWrite)];
				recordBufferArray.push(...numberBytes);
			}
			else if(field.type === FIELD_TYPE_STRING)
			{
				let stringBytes = [...Buffer.from(valueToWrite, 'utf8')];
				stringBytes.push(0x00);
				let stringLengthBytes = [...utilFunctions.writeModifiedLebEncodedNumber(stringBytes.length)];
				recordBufferArray.push(...stringLengthBytes); 
				recordBufferArray.push(...stringBytes);
			}
			else if(field.type === FIELD_TYPE_FLOAT)
			{
				let floatBytes = Buffer.alloc(4);
				floatBytes.writeFloatBE(valueToWrite);
				recordBufferArray.push(...floatBytes);
			}
			else if(field.type === FIELD_TYPE_ARRAY)
			{
				// Unknown byte
				recordBufferArray.push(0x03);

				// Number of elements in the array
				recordBufferArray.push(valueToWrite.length);

				for(const element of valueToWrite)
				{
					let elementBytes = writeChviRecord(element);
					recordBufferArray.push(...elementBytes);
					
					// Each element is followed by a 0x00 byte
					recordBufferArray.push(0x00);
				}
			}
		}

		return recordBufferArray;
	}

	// Function to convert league visuals JSON to H2 file
	async function convertLeagueVisualsToH2()
	{
		getGameYear();
		
		// Set up data buffer
		console.log("\nEnter the path to the league visuals JSON file: ");
		const visualsPath = prompt().trim().replace(/['"]/g, '');
		const visualsJson = JSON.parse(fs.readFileSync(visualsPath, 'utf8'));

		const visualsKey = Object.keys(visualsJson)[0];
		
		const visualsJsonData = visualsJson[visualsKey]; 

		let recordsObject = {};

		// Iterate through each key in the JSON data
		const keys = Object.keys(visualsJsonData).sort((a, b) => parseInt(a) - parseInt(b));

		for(const key of keys)
		{
			// Common entry header
			let recordBytes = [0x8E, 0x8D, 0xA9, 0x03];
			let extraHeader = [0x8E, 0x88, 0x6E, 0x03, 0x8E, 0x88, 0x6E, 0x03, 0x00, 0x00];

			if(currentGameYear >= 26)
			{
				recordBytes = extraHeader.concat(recordBytes);
			}

			// Write the record data
			recordBytes.push(...writeChviRecord(visualsJsonData[key]));

			// Each record is concluded by a 0x00 byte
			recordBytes.push(0x00);

			// Write the record to a file
			const recordBuffer = Buffer.from(recordBytes);
			recordsObject[key] = recordBuffer;
		}

		// Output file info
		console.log("\nEnter the name of the output file (without extension):");
		const outputName = prompt().trim().replace(/['"]/g, '');

		const tableName = currentGameYear >= 26 ? "BLBM" : visualsKey === "characterVisualsCoachMap" ? "COEX" : "PLEX";

		// Write the records to the output file
		await writeRecords(recordsObject, outputName, tableName);
		
	}

	// Function to find object in JSON based on value of key
	function findFieldByFieldKey(fieldKey)
	{
		const fields = Object.keys(fieldLookup);

		for(const field of fields)
		{
			if(fieldLookup[field].key === fieldKey)
			{
				return field;
			}
		}
	}

	function findEnumValByNum(object, enumNum)
	{
		const fields = Object.keys(object);

		for(const field of fields)
		{
			if(object[field] === enumNum)
			{
				return field;
			}
		}
	}


	// Function to read a CHVI array
	function readChviArray(parser, arrayLength)
	{
		let array = [];

		for(let i = 0; i < arrayLength; i++)
		{
			let recordObject = {};
			let previousByte = -1;

			do
			{
				if(previousByte !== -1)
				{
					parser.offset = parser.offset - 1;
				}
				let fieldKey = utilFunctions.getUncompressedTextFromSixBitCompression(parser.readBytes(3));
				let fieldName = findFieldByFieldKey(fieldKey);

				let fieldType = parser.readByte().readUInt8(0);

				switch(fieldType)
				{
					case FIELD_TYPE_INT:
						let intValue = utilFunctions.readModifiedLebEncodedNumber(parser);

						if(!fieldName)
						{
							break;
						}

						// Check for special cases that require lookups
						if(fieldName === "slotType")
						{
							intValue = slotsLookup[intValue];
						}
						else if(fieldName === "loadoutType" || fieldName === "loadoutCategory")
						{
							intValue = findEnumValByNum(enumLookup[fieldName], intValue);
						}
						else if(fieldName === "skinToneScale")
						{
							intValue = -8355712;
						}

						recordObject[fieldName] = intValue;
						break;
					case FIELD_TYPE_STRING:
						let stringLength = utilFunctions.readModifiedLebEncodedNumber(parser);
						let stringValue = parser.readBytes(stringLength);
						// Remove null terminator from string
						stringValue = stringValue.slice(0, -1).toString('utf8');

						if(!fieldName)
						{
							break;
						}

						recordObject[fieldName] = stringValue;
						break;
					case FIELD_TYPE_FLOAT:
						let floatValue = parser.readBytes(4).readFloatBE(0);

						if(!fieldName)
						{
							break;
						}

						recordObject[fieldName] = floatValue;
						break;
					case FIELD_TYPE_ARRAY:
						parser.readByte();
						let arrayLength = utilFunctions.readModifiedLebEncodedNumber(parser);
						let arrayObject = readChviArray(parser, arrayLength);

						if(!fieldName)
						{
							break;
						}

						recordObject[fieldName] = arrayObject;
						break;
					default:
						break;
				}

				previousByte = parser.readByte().readUInt8(0);
			}
			while(previousByte !== 0x00);

			array.push(recordObject);
		}

		return array;
	}


	// Function to read a CHVI record
	function readChviRecord(parser)
	{
		let recordObject = {};

		while(parser.offset < (parser.buffer.length - 1))
		{
			let fieldBytes = parser.readBytes(3);
			let fieldKey = utilFunctions.getUncompressedTextFromSixBitCompression(fieldBytes);

			let fieldName = findFieldByFieldKey(fieldKey);
			let fieldType = parser.readByte().readUInt8(0);

			if(fieldType === 0x03)
			{
				parser.readBytes(1);
				continue;
			}
			switch(fieldType)
			{
				case FIELD_TYPE_INT:
					if(fieldName === "skinToneScale")
					{
						let intValue = -8355712;
						recordObject[fieldName] = intValue;
						parser.readBytes(4);
						break;
					}

					let intValue = utilFunctions.readModifiedLebEncodedNumber(parser);

					if(!fieldName)
					{
						break;
					}

					// Check for special cases that require lookups
					if(fieldName === "slotType")
					{
						intValue = slotsLookup[intValue];
					}
					else if(fieldName === "loadoutType" || fieldName === "loadoutCategory")
					{
						intValue = enumLookup[fieldName][intValue];
					}

					recordObject[fieldName] = intValue;
					break;
				case FIELD_TYPE_STRING:
					let stringLength = utilFunctions.readModifiedLebEncodedNumber(parser);
					let stringValue = parser.readBytes(stringLength);
					// Remove null terminator from string
					stringValue = stringValue.slice(0, -1).toString('utf8');

					if(!fieldName)
					{
						break;
					}

					recordObject[fieldName] = stringValue;
					break;
				case FIELD_TYPE_FLOAT:
					let floatValue = parser.readBytes(4).readFloatBE(0);

					if(!fieldName)
					{
						break;
					}

					recordObject[fieldName] = floatValue;
					break;
				case FIELD_TYPE_ARRAY:
					parser.readByte();
					let arrayLength = utilFunctions.readModifiedLebEncodedNumber(parser);
					let arrayObject = readChviArray(parser, arrayLength);
					
					if(!fieldName)
					{
						break;
					}

					if(parser.readByte().readUInt8(0) !== 0x00)
					{
						parser.offset = parser.offset - 1;
					}

					recordObject[fieldName] = arrayObject;
				default:
					break;

			}
		}

		return recordObject;
	}

	async function convertH2ToLeagueVisuals()
	{
		getGameYear();
		
		// Set up data buffer
		console.log("\nEnter the path to the H2 archive file: ");
		const visualsPath = prompt().trim().replace(/['"]/g, '');
		let h2Data = fs.readFileSync(visualsPath);
		let parser = new FileParser(h2Data);
		// Read the start of the file
		if(currentGameYear >= 26)
		{
			parser.readBytes(6);
		}


		const tableBytes = parser.readBytes(3);
		const tableName = utilFunctions.getUncompressedTextFromSixBitCompression(tableBytes);
		const type = parser.readByte().readUInt8(0);
		const unkBytes = parser.readBytes(2);
		const recordCount = utilFunctions.readModifiedLebEncodedNumber(parser);

		let visualType;

		if(currentGameYear === 26)
		{
			console.log("Is this a player or coach visual? (Enter 'p' for player, 'c' for coach)");
			visualType = prompt().trim().toLowerCase();
		}

		const mapType = tableName === "COEX" || (visualType && visualType === "c") ? "characterVisualsCoachMap" : "characterVisualsPlayerMap";

		let recordsObject = {
			[mapType]: {}
		};

		// Read each record
		for(let i = 0; i < recordCount; i++)
		{
			const recordKey = utilFunctions.readModifiedLebEncodedNumber(parser);
			const recordByteSize = utilFunctions.readModifiedLebEncodedNumber(parser);

			const recordData = parser.readBytes(recordByteSize);
			const decompressedData = await utilFunctions.decompressBuffer(recordData);

			if(recordKey === 0)
			{
				continue;
			}

			// Parse the record data
			let recordParser = new FileParser(decompressedData);
			// Skip record header
			recordParser.readBytes(currentGameYear >= 26 ? 14 : 4);
			let recordObject = readChviRecord(recordParser);

			recordsObject[mapType][recordKey] = recordObject;
		}

		// Output file info
		console.log("\nEnter the name of the output file (without extension):");
		const outputName = prompt().trim().replace(/['"]/g, '');

		// Write the JSON data to the output file
		fs.writeFileSync(outputName + ".json", JSON.stringify(recordsObject, null, 4));
	}

	async function convert25LeagueVisualsTo26()
	{
		// Set up data buffer
		console.log("\nEnter the path to the M25 league visuals JSON file: ");
		const visualsPath = prompt().trim().replace(/['"]/g, '');
		const visualsJson = JSON.parse(fs.readFileSync(visualsPath, 'utf8'));

		const visualsMap = visualsJson.characterVisualsPlayerMap || visualsJson.characterVisualsCoachMap;

		const keys = Object.keys(visualsMap);

		for(const key of keys)
		{
			let recordObject = visualsMap[key];
			let loadouts = recordObject.loadouts || [];

			// If there is no loadout with category base and the bodyType field exists, add a new base loadout
			if(!loadouts.some(loadout => loadout.loadoutCategory && loadout.loadoutCategory.toLowerCase() === "base") && recordObject.bodyType)
			{
				let newLoadout = {
					loadoutCategory: "Base",
					loadoutElements: []
				};

				loadouts.push(newLoadout);
			}

			for(let i = 0; i < loadouts.length; i++)
			{
				const loadout = loadouts[i];

				if(loadout.loadoutCategory && loadout.loadoutCategory.toLowerCase() === "base" && recordObject.bodyType)
				{
					if(bodyTypeLookup.hasOwnProperty(recordObject.bodyType))
					{
						let newLoadoutElement = {
							slotType: "CharacterBodyType",
							itemAssetName: bodyTypeLookup[recordObject.bodyType]
						}

						loadout.loadoutElements = loadout.loadoutElements || [];
						loadout.loadoutElements.push(newLoadoutElement);
					}
				}

				const loadoutElements = loadout.loadoutElements || [];

				for(let j = 0; j < loadoutElements.length; j++)
				{
					const loadoutElement = loadoutElements[j];

					if(loadoutElement.slotType && m25to26Lookup.hasOwnProperty(loadoutElement.slotType.toLowerCase()))
					{						
						loadoutElement.slotType = m25to26Lookup[loadoutElement.slotType.toLowerCase()];

						if(loadoutElement.slotType.toLowerCase() === "leftthighwear")
						{
							// Make new copy of this loadout element for right thigh wear
							let rightThighWearElement = JSON.parse(JSON.stringify(loadoutElement));
							rightThighWearElement.slotType = "RightThighWear";
							// Add the new element to the loadouts array
							loadoutElements.push(rightThighWearElement);
						}
					}
				}
			}
		}

		// Output file info
		console.log("\nEnter the name of the output file:");
		const outputName = prompt().trim().replace(/['"]/g, '');

		// Write the JSON data to the output file
		fs.writeFileSync(outputName, JSON.stringify(visualsJson, null, 4));

		console.log(`\nConverted M25 visuals JSON to M26 visuals JSON and saved to ${outputName}.`);
	}

	async function convert26LeagueVisualsTo25()
	{
		// Set up data buffer
		console.log("\nEnter the path to the M26 league visuals JSON file: ");
		const visualsPath = prompt().trim().replace(/['"]/g, '');
		const visualsJson = JSON.parse(fs.readFileSync(visualsPath, 'utf8'));

		const visualsMap = visualsJson.characterVisualsPlayerMap || visualsJson.characterVisualsCoachMap;

		const keys = Object.keys(visualsMap);

		for(const key of keys)
		{
			let recordObject = visualsMap[key];
			let loadouts = recordObject.loadouts || [];

			for(let i = 0; i < loadouts.length; i++)
			{
				const loadout = loadouts[i];

				const loadoutElements = loadout.loadoutElements || [];

				for(let j = 0; j < loadoutElements.length; j++)
				{
					const loadoutElement = loadoutElements[j];

					if(!loadoutElement.slotType && loadoutElement.itemAssetName && loadoutElement.itemAssetName.toLowerCase().includes("gearfacemask"))
					{
						loadoutElement.slotType = "Facemask";
						continue;
					}

					if(loadoutElement.slotType && loadoutElement.slotType.toLowerCase() === "characterbodytype")
					{
						// Find the key in the bodyTypeLookup which has a value matching the itemAssetName
						let bodyTypeKey = Object.keys(bodyTypeLookup).find(key => bodyTypeLookup[key].toLowerCase() === loadoutElement.itemAssetName.toLowerCase());

						if(bodyTypeKey)
						{
							recordObject.bodyType = bodyTypeKey;
						}

						// Remove the loadout element
						loadoutElements.splice(j, 1);
						j--;
						continue;
					}

					if(loadoutElement.slotType.toLowerCase() === "rightthighwear")
					{
						// Remove the right thigh wear element
						loadoutElements.splice(j, 1);
						j--;
						continue;
					}

					if(!m26to25Lookup.hasOwnProperty(loadoutElement.slotType.toLowerCase()) && !m25SlotNumLookup.hasOwnProperty(loadoutElement.slotType.toLowerCase()))
					{
						loadoutElements.splice(j, 1);
						j--;
						continue;
					}

					if(loadoutElement.slotType && m26to25Lookup.hasOwnProperty(loadoutElement.slotType.toLowerCase()))
					{
						loadoutElement.slotType = m26to25Lookup[loadoutElement.slotType.toLowerCase()];
					}
				}
			}
		}

		// Output file info
		console.log("\nEnter the name of the output file:");
		const outputName = prompt().trim().replace(/['"]/g, '');

		// Write the JSON data to the output file
		fs.writeFileSync(outputName, JSON.stringify(visualsJson, null, 4));

		console.log(`\nConverted M25 visuals JSON to M26 visuals JSON and saved to ${outputName}.`);
	}

	const options = ["Read raw records from H2 file", "Write raw records to H2 file", "Convert visuals JSON to H2 file", "Convert H2 file to visuals JSON", "Convert M25 visuals JSON to M26 visuals JSON", "Convert M26 visuals JSON to M25 visuals JSON", "Exit program"];

	// Main program logic
	console.log(`Welcome to H2 Visuals Tools ${VERSION_STRING}! This program will help you read, write, and convert H2 visuals files.\n`);
	
	do
	{
		console.log("MAIN MENU:")
		options.forEach((option, index) => {
			console.log(`${index + 1}. ${option}`);
		});

		console.log("\nEnter the number of the option you'd like to select: ");

		let option = parseInt(prompt().trim());

		if(option < 1 || option > options.length || Number.isNaN(option))
		{
			console.log("Invalid option. Please enter a valid option.");
			continue;
		}

		if(option === 1)
		{
			await readRecords();
		}
		else if(option === 2)
		{
			await writeRecords();
		}
		else if(option === 3)
		{
			await convertLeagueVisualsToH2();
		}
		else if(option === 4)
		{
			await convertH2ToLeagueVisuals();
		}
		else if(option === 5)
		{
			await convert25LeagueVisualsTo26();
		}
		else if(option === 6)
		{
			await convert26LeagueVisualsTo25();
		}
		else if(option === 7)
		{
			break;
		}

		console.log("\n");

	}
	while(true);

	

})();
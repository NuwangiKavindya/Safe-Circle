const dotenv = require('dotenv');
dotenv.config();

const { connectDB } = require('./config/db');
const User = require('./models/User');
const TrustedContact = require('./models/TrustedContact');

async function verifyContacts() {
    console.log('Starting Trusted Contacts validation test...');
    try {
        await connectDB();

        // 1. Create a verification user
        console.log('\n--- Creating Test User ---');
        const user = await User.create({
            fullName: 'Contact Verification Tester',
            email: `contact-tester-${Date.now()}@example.com`,
            phoneNumber: `+1666666${Math.floor(1000 + Math.random() * 9000)}`,
            password: 'password123',
            confirmPassword: 'password123'
        });
        console.log(`Created User ID: ${user.id}`);

        // 2. Add a trusted contact and verify automatic accessCode generation
        console.log('\n--- Adding Trusted Contact ---');
        const contact = await TrustedContact.create({
            userId: user.id,
            contactName: 'Jane Alert Contact',
            contactPhone: '+17777777777',
            contactEmail: 'jane.alert@example.com',
            relationship: 'Partner'
        });

        console.log(`Created Trusted Contact: ${contact.contactName}`);
        console.log(`Generated Secure Access Code: ${contact.accessCode}`);

        // Check format of accessCode (should be SC-XXXXXXXX 8-character hex handle)
        if (/^SC-[A-F0-9]{8}$/.test(contact.accessCode)) {
            console.log('✅ Success: Access Code is a valid SC-XXXXXXXX cryptographic handle!');
        } else {
            throw new Error(`❌ Error: Access Code "${contact.accessCode}" is not a valid SC-XXXXXXXX handle.`);
        }

        // Check RFC 6238 TOTP Secret generation
        if (contact.totpSecret && contact.totpSecret.length >= 16) {
            console.log('✅ Success: RFC 6238 TOTP secret generated successfully!');
        } else {
            throw new Error('❌ Error: Missing or invalid totpSecret.');
        }

        // 3. Retrieve contacts for user
        console.log('\n--- Retrieving Safety Circle Contacts ---');
        const userContacts = await TrustedContact.findAll({
            where: { userId: user.id }
        });
        console.log(`Found ${userContacts.length} contact(s) for user.`);
        if (userContacts.length === 1 && userContacts[0].id === contact.id) {
            console.log('✅ Success: Correct contact list returned!');
        } else {
            throw new Error('❌ Error: Contact list verification failed.');
        }

        // 4. Cleanup and cascade test
        console.log('\n--- Cleaning Up ---');
        await user.destroy();
        const contactCheck = await TrustedContact.findByPk(contact.id);
        if (!contactCheck) {
            console.log('✅ Success: Cascade delete successfully removed contact records!');
        } else {
            throw new Error('❌ Error: Cascade delete failed. Contact record still exists.');
        }

        console.log('\n🎉 ALL TRUSTED NETWORK SCHEMA TESTS PASSED SUCCESSFULLY!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Trusted Contacts API Verification Failed:', err.message);
        process.exit(1);
    }
}

verifyContacts();

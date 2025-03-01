'use server';

import { ID, Query } from "node-appwrite";
import { createAdminClient, createSessionClient } from "../appwrite";
import { cookies } from "next/headers";
import { encryptId, extractCustomerIdFromUrl, parseStringify } from "../utils";
import { CountryCode, ProcessorTokenCreateRequest, ProcessorTokenCreateRequestProcessorEnum, Products } from "plaid";

import { plaidClient } from '@/lib/plaid';
import { revalidatePath } from "next/cache";
import { addFundingSource, createDwollaCustomer } from "./dwolla.actions";

// ----------------------------------------
// Update Dwolla Payload Interface: now state is required
// ----------------------------------------
export interface NewDwollaCustomerParams {
  firstName: string;
  lastName: string;
  email: string;
  address1: string;
  city: string;
  state: string; // state is now required for Dwolla
  postalCode: string;
  dateOfBirth: string;
  ssn: string;
  type: 'personal' | 'business';
}

// Appwrite environment variables
const {
  APPWRITE_DATABASE_ID: DATABASE_ID,
  APPWRITE_USER_COLLECTION_ID: USER_COLLECTION_ID,
  APPWRITE_BANK_COLLECTION_ID: BANK_COLLECTION_ID,
} = process.env;

// ----------------------------------------
// getUserInfo
// ----------------------------------------
export const getUserInfo = async ({ userId }: getUserInfoProps) => {
  console.log("[getUserInfo] Called with userId:", userId);
  try {
    const { database } = await createAdminClient();
    console.log("[getUserInfo] Querying user collection:", USER_COLLECTION_ID);

    const result = await database.listDocuments(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      [Query.equal('userId', [userId])]
    );

    if (!result.documents || result.documents.length === 0) {
      console.warn("[getUserInfo] No user document found for userId:", userId);
      return null;
    }

    console.log("[getUserInfo] Found user document:", result.documents[0].$id);
    return parseStringify(result.documents[0]);
  } catch (error) {
    console.log("[getUserInfo] Error:", error);
    return null;
  }
};

// ----------------------------------------
// signIn
// ----------------------------------------
export const signIn = async ({ email, password }: signInProps) => {
  console.log("[signIn] Called with email:", email);
  try {
    const { account } = await createAdminClient();
    console.log("[signIn] Creating email/password session...");

    const session = await account.createEmailPasswordSession(email, password);
    console.log("[signIn] Session created. userId:", session.userId);

    cookies().set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    console.log("[signIn] Getting user info for userId:", session.userId);
    const user = await getUserInfo({ userId: session.userId });
    if (!user) {
      throw new Error("User data not found during sign in.");
    }

    console.log("[signIn] Sign in successful for userId:", session.userId);
    return parseStringify(user);
  } catch (error) {
    console.error("[signIn] Error:", error);
    return null;
  }
};

// ----------------------------------------
// signUp
// ----------------------------------------
export const signUp = async ({ password, ...userData }: SignUpParams) => {
  console.log("[signUp] Called with:", userData);

  // Destructure fields for both Dwolla and Appwrite document.
  // For Dwolla, we require state. For the custom user document,
  // you might choose to omit state if your schema doesn't allow it.
  const {
    email,
    firstName,
    lastName,
    address1,
    city,
    state,         // required for Dwolla payload
    postalCode,
    dateOfBirth,
    ssn,
  } = userData;

  try {
    const { account, database } = await createAdminClient();

    console.log("[signUp] Creating new Appwrite user with email:", email);
    const newUserAccount = await account.create(
      ID.unique(),
      email,
      password,
      `${firstName} ${lastName}`
    );
    if (!newUserAccount) throw new Error('Error creating user');
    console.log("[signUp] Appwrite user created. userId:", newUserAccount.$id);

    // Construct Dwolla payload including state (as required)
    const dwollaPayload: NewDwollaCustomerParams = {
      firstName,
      lastName,
      email,
      address1,
      city,
      state, // include state here for Dwolla validation
      postalCode,
      dateOfBirth,
      ssn,
      type: 'personal',
    };

    console.log("[signUp] Creating Dwolla customer with payload:", dwollaPayload);
    const dwollaCustomerUrl = await createDwollaCustomer(dwollaPayload);
    if (!dwollaCustomerUrl) throw new Error('Error creating Dwolla customer');
    console.log("[signUp] Dwolla customer created:", dwollaCustomerUrl);

    const dwollaCustomerId = extractCustomerIdFromUrl(dwollaCustomerUrl);

    console.log("[signUp] Creating document in user collection with userId:", newUserAccount.$id);
    // Build newUserData for Appwrite document. Exclude 'state' if your schema doesn't support it.
    const newUserData = {
      email,
      firstName,
      lastName,
      address1,
      city,
      postalCode,
      dateOfBirth,
      ssn,
      userId: newUserAccount.$id,
      dwollaCustomerId,
      dwollaCustomerUrl
    };

    const newUser = await database.createDocument(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      ID.unique(),
      newUserData
    );
    console.log("[signUp] User document created in custom collection:", newUser.$id);

    console.log("[signUp] Creating email/password session to sign in user...");
    const session = await account.createEmailPasswordSession(email, password);
    console.log("[signUp] Session created. userId:", session.userId);

    cookies().set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });
    console.log("[signUp] Sign-up complete. User signed in.");

    return parseStringify(newUser);
  } catch (error) {
    console.error("[signUp] Error:", error);
    return null;
  }
};

// ----------------------------------------
// getLoggedInUser
// ----------------------------------------
export async function getLoggedInUser() {
  console.log("[getLoggedInUser] Called");
  try {
    const { account } = await createSessionClient();
    console.log("[getLoggedInUser] Getting account session user...");
    const result = await account.get();

    if (!result || !result.$id) {
      console.warn("[getLoggedInUser] No user session found.");
      return null;
    }
    console.log("[getLoggedInUser] Session user found. userId:", result.$id);

    const user = await getUserInfo({ userId: result.$id });
    if (!user) {
      console.warn("[getLoggedInUser] No user data found for logged in user.");
      return null;
    }
    console.log("[getLoggedInUser] Returning user data for userId:", user.userId);
    return parseStringify(user);
  } catch (error) {
    console.log("[getLoggedInUser] Error:", error);
    return null;
  }
}

// ----------------------------------------
// logoutAccount
// ----------------------------------------
export const logoutAccount = async () => {
  console.log("[logoutAccount] Called");
  try {
    const { account } = await createSessionClient();
    cookies().delete('appwrite-session');
    await account.deleteSession('current');
    console.log("[logoutAccount] Session deleted successfully.");
  } catch (error) {
    console.log("[logoutAccount] Error:", error);
    return null;
  }
};

// ----------------------------------------
// createLinkToken
// ----------------------------------------
export const createLinkToken = async (user: User) => {
  console.log("[createLinkToken] Called with userId:", user.$id);
  try {
    const tokenParams = {
      user: {
        client_user_id: user.$id
      },
      client_name: `${user.firstName} ${user.lastName}`,
      products: ['auth'] as Products[],
      language: 'en',
      country_codes: ['US'] as CountryCode[],
    };

    const response = await plaidClient.linkTokenCreate(tokenParams);
    console.log("[createLinkToken] Link token created.");
    return parseStringify({ linkToken: response.data.link_token });
  } catch (error) {
    console.log("[createLinkToken] Error:", error);
    return null;
  }
};

// ----------------------------------------
// createBankAccount
// ----------------------------------------
export const createBankAccount = async ({
  userId,
  bankId,
  accountId,
  accessToken,
  fundingSourceUrl,
  shareableId,
}: createBankAccountProps) => {
  console.log("[createBankAccount] Called with userId:", userId);
  try {
    const { database } = await createAdminClient();
    console.log("[createBankAccount] Creating bank account document...");
    const bankAccount = await database.createDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      ID.unique(),
      {
        userId,
        bankId,
        accountId,
        accessToken,
        fundingSourceUrl,
        shareableId,
      }
    );
    console.log("[createBankAccount] Bank account document created:", bankAccount.$id);
    return parseStringify(bankAccount);
  } catch (error) {
    console.log("[createBankAccount] Error:", error);
    return null;
  }
};

// ----------------------------------------
// exchangePublicToken
// ----------------------------------------
export const exchangePublicToken = async ({
  publicToken,
  user,
}: exchangePublicTokenProps) => {
  console.log("[exchangePublicToken] Called with userId:", user.$id);
  try {
    console.log("[exchangePublicToken] Exchanging public token with Plaid...");
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    console.log("[exchangePublicToken] Getting account info from Plaid...");
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });
    const accountData = accountsResponse.data.accounts[0];
    if (!accountData || !accountData.account_id) {
      throw new Error("Invalid account data received from Plaid.");
    }

    console.log("[exchangePublicToken] Creating processor token for Dwolla...");
    const request: ProcessorTokenCreateRequest = {
      access_token: accessToken,
      account_id: accountData.account_id,
      processor: "dwolla" as ProcessorTokenCreateRequestProcessorEnum,
    };
    const processorTokenResponse = await plaidClient.processorTokenCreate(request);
    const processorToken = processorTokenResponse.data.processor_token;

    console.log("[exchangePublicToken] Creating funding source URL...");
    const fundingSourceUrl = await addFundingSource({
      dwollaCustomerId: user.dwollaCustomerId,
      processorToken,
      bankName: accountData.name,
    });
    if (!fundingSourceUrl) throw new Error("Error creating funding source");

    console.log("[exchangePublicToken] Generating shareableId...");
    const shareableId = accountData.account_id ? encryptId(accountData.account_id) : null;
    if (!shareableId) {
      throw new Error("Failed to generate shareableId");
    }

    console.log("[exchangePublicToken] Creating bank account document...");
    await createBankAccount({
      userId: user.$id,
      bankId: itemId,
      accountId: accountData.account_id,
      accessToken,
      fundingSourceUrl,
      shareableId,
    });

    console.log("[exchangePublicToken] Revalidating path...");
    revalidatePath("/");

    console.log("[exchangePublicToken] Exchange complete, returning success message.");
    return parseStringify({ publicTokenExchange: "complete" });
  } catch (error) {
    console.error("[exchangePublicToken] Error:", error);
    return null;
  }
};

// ----------------------------------------
// getBanks
// ----------------------------------------
export const getBanks = async ({ userId }: getBanksProps) => {
  console.log("[getBanks] Called with userId:", userId);
  try {
    const { database } = await createAdminClient();
    console.log("[getBanks] Listing bank documents...");
    const banks = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal('userId', [userId])]
    );
    console.log("[getBanks] Found bank docs. Count:", banks.total);
    return parseStringify(banks.documents);
  } catch (error) {
    console.log("[getBanks] Error:", error);
    return null;
  }
};

// ----------------------------------------
// getBank
// ----------------------------------------
export const getBank = async ({ documentId }: getBankProps) => {
  console.log("[getBank] Called with documentId:", documentId);
  try {
    const { database } = await createAdminClient();
    const bank = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal('$id', [documentId])]
    );
    if (!bank.documents || bank.documents.length === 0) {
      console.warn("[getBank] No bank document found for documentId:", documentId);
      return null;
    }
    console.log("[getBank] Returning bank document:", bank.documents[0].$id);
    return parseStringify(bank.documents[0]);
  } catch (error) {
    console.log("[getBank] Error:", error);
    return null;
  }
};

// ----------------------------------------
// getBankByAccountId
// ----------------------------------------
export const getBankByAccountId = async ({ accountId }: getBankByAccountIdProps) => {
  console.log("[getBankByAccountId] Called with accountId:", accountId);
  try {
    const { database } = await createAdminClient();
    const bank = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal('accountId', [accountId])]
    );
    console.log("[getBankByAccountId] Found bank docs. Count:", bank.total);
    if (bank.total !== 1) {
      console.warn("[getBankByAccountId] No unique bank document found for accountId:", accountId);
      return null;
    }
    console.log("[getBankByAccountId] Returning bank document:", bank.documents[0].$id);
    return parseStringify(bank.documents[0]);
  } catch (error) {
    console.log("[getBankByAccountId] Error:", error);
    return null;
  }
};

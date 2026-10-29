/** Where an unfinished campaign waits on this device ("Save & exit"), per signed-in user. */
export const campaignDraftKey = (uid: string) => `divvit.mp.campaign.${uid}`;

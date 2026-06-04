import SevDeskAPI from "./index";
import { requireSevDeskApiKey } from "./config";

export function createSevDeskApi(): SevDeskAPI {
  return new SevDeskAPI(requireSevDeskApiKey());
}

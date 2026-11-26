import { selectLoadTestProviders } from "../../../Source/Features/LoadTesting/provider-selection";
describe("provider selection", () => {
  test("normal traffic has no selected simulation", () => {
    expect(selectLoadTestProviders(null, null)).toBeNull();
  });
});

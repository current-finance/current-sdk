import json
import unittest
from pathlib import Path
from repayment_receipt import reconcile


class RepaymentTest(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name("repayment-example.json")
        self.evidence = json.loads(path.read_text())
        self.tx = self.evidence["transaction"]
        self.digest = self.tx["digest"]

    def test_sample(self):
        receipt = reconcile(self.digest, self.evidence)
        self.assertEqual(receipt["repaidUSDC"], "9")
        self.assertEqual(receipt["indexAccrualUSDC"], "4.115016029098925041599183")
        self.assertEqual(receipt["storedDebtDecreaseUSDC"], "4.884983970901074958400817")

    def test_wrong_obligation_table(self):
        self.evidence["position"]["asMoveObject"]["contents"]["json"]["debts"]["table"]["id"] = "0x1"
        with self.assertRaisesRegex(ValueError, "different obligation table"):
            reconcile(self.digest, self.evidence)

    def test_different_digest(self):
        with self.assertRaisesRegex(ValueError, "Digest differs"):
            reconcile("3G1cX2qtAnTVbX7SyZwcNgpKPwqUaMmyBbBU7ULoNY91", self.evidence)

    def test_incomplete_history(self):
        self.tx["effects"]["objectChanges"]["pageInfo"]["hasNextPage"] = True
        with self.assertRaisesRegex(ValueError, "Incomplete objectChanges"):
            reconcile(self.digest, self.evidence)

    def test_refunded_payment(self):
        self.tx["effects"]["events"]["nodes"][0]["contents"]["json"]["refund"] = "999757"
        with self.assertRaisesRegex(ValueError, "zero refund"):
            reconcile(self.digest, self.evidence)

    def test_inconsistent_amount(self):
        self.tx["effects"]["events"]["nodes"][0]["contents"]["json"]["amount"] = "9000001"
        with self.assertRaisesRegex(ValueError, "differs from resulting debt"):
            reconcile(self.digest, self.evidence)


if __name__ == "__main__":
    unittest.main()

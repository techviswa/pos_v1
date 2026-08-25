"""
POS System - Backend API Test Suite
====================================
Usage:
    python backend_test.py

Environment variables (all optional, defaults shown):
    API_BASE_URL       Base URL of the API  (default: http://localhost:4001)
    TEST_OWNER_EMAIL   Owner login email    (default: owner@pos.com)
    TEST_OWNER_PASSWORD Owner login password (default: admin123)
"""

from __future__ import annotations  # FIX: enables modern type hints on Python < 3.10

import os
import sys
import requests
from datetime import datetime
from uuid import uuid4

# ---------------------------------------------------------------------------
# Configuration — read from environment so no secrets live in source code
# ---------------------------------------------------------------------------
BASE_URL       = os.getenv("API_BASE_URL",        "http://localhost:4001")
OWNER_EMAIL    = os.getenv("TEST_OWNER_EMAIL",    "owner@pos.com")
OWNER_PASSWORD = os.getenv("TEST_OWNER_PASSWORD", "admin123")


class POSAPITester:
    def __init__(self, base_url: str = BASE_URL):
        self.base_url     = base_url.rstrip("/")
        self.tests_run    = 0
        self.tests_passed = 0
        # One session for the owner (authenticated throughout most tests)
        self.owner_session = requests.Session()

    def unique_suffix(self) -> str:
        """
        Generate a collision-resistant suffix for test users/products created in
        quick succession on Windows.
        """
        return f"{datetime.now().strftime('%H%M%S%f')}-{uuid4().hex[:6]}"

    def unwrap_response_data(self, payload):
        """Extract the actual API payload from the standard apiResponse envelope."""
        if isinstance(payload, dict):
            if "data" in payload and isinstance(payload["data"], (dict, list)):
                return payload["data"]
            return payload
        return payload

    # ------------------------------------------------------------------
    # Core helper
    # ------------------------------------------------------------------
    def run_test(
        self,
        name: str,
        method: str,
        endpoint: str,
        expected_status: int,
        data: "dict | None" = None,
        session: "requests.Session | None" = None,
        headers: "dict | None" = None,
    ) -> "tuple[bool, dict]":
        """
        Execute one HTTP request and check its status code.

        Parameters
        ----------
        session : requests.Session, optional
            Defaults to self.owner_session.  Pass a different session to
            test requests authenticated as another user (e.g. a cashier).

        Returns
        -------
        (bool, dict)  success flag + parsed JSON body (empty dict on failure)
        """
        if session is None:
            session = self.owner_session

        url          = f"{self.base_url}/api/{endpoint}"
        test_headers = {"Content-Type": "application/json"}
        if headers:
            test_headers.update(headers)

        self.tests_run += 1
        print(f"\n[TEST] {name}...")

        try:
            method_upper = method.upper()
            if method_upper == "GET":
                response = session.get(url, headers=test_headers)
            elif method_upper == "POST":
                response = session.post(url, json=data, headers=test_headers)
            elif method_upper == "PUT":
                response = session.put(url, json=data, headers=test_headers)
            elif method_upper == "DELETE":
                response = session.delete(url, headers=test_headers)
            else:
                # Fail loudly instead of leaving `response` undefined
                raise ValueError(f"Unsupported HTTP method: '{method}'")

            acceptable_statuses = {expected_status}
            if expected_status == 200:
                acceptable_statuses = {200, 201}
            elif expected_status == 201:
                acceptable_statuses = {200, 201}

            success = response.status_code in acceptable_statuses
            if success:
                self.tests_passed += 1
                print(f"[PASS] Status: {response.status_code}")
            else:
                print(f"[FAIL] Expected {expected_status}, got {response.status_code}")

            # Always try to return JSON; never silently swallow every exception
            try:
                body = response.json()
                return success, self.unwrap_response_data(body)
            except (ValueError, requests.exceptions.JSONDecodeError) as exc:
                if not success:
                    print(f"   Response text: {response.text[:200]}")
                else:
                    print(f"   Note: response body is not JSON ({exc})")
                return success, {}

        except ValueError:
            # Re-raise our own unsupported-method error
            raise
        except Exception as exc:
            print(f"[FAIL] Error: {exc}")
            return False, {}

    # ------------------------------------------------------------------
    # Owner authentication
    # ------------------------------------------------------------------
    def test_owner_login(self) -> bool:
        """Test owner login — authenticates self.owner_session for all later tests."""
        print("\n=== TESTING OWNER AUTHENTICATION ===")
        success, response = self.run_test(
            "Owner Login",
            "POST",
            "auth/login",
            200,
            data={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        )
        if success:
            print(f"   Owner logged in: {response.get('name')} ({response.get('role')})")
            return True
        return False

    def test_owner_me(self) -> bool:
        """Confirm the session cookie belongs to the owner role."""
        success, response = self.run_test("Owner /auth/me", "GET", "auth/me", 200)
        user = self.unwrap_response_data(response)
        if success and user.get("role") == "Owner":
            print(f"   Owner verified: {user.get('email')}")
            return True
        return False

    # ------------------------------------------------------------------
    # Dashboard
    # ------------------------------------------------------------------
    def test_dashboard_stats(self) -> bool:
        """Dashboard endpoint is accessible to the owner."""
        print("\n=== TESTING DASHBOARD ===")
        success, response = self.run_test("Dashboard Stats", "GET", "dashboard/stats", 200)
        if success:
            print(
                f"   Stats - Sales Today: Rs.{response.get('total_sales_today', 0)}, "
                f"Bills: {response.get('bills_count_today', 0)}"
            )
            return True
        return False

    # ------------------------------------------------------------------
    # Products CRUD
    # ------------------------------------------------------------------
    def test_products_crud(self) -> bool:
        """Create → Update → Delete a product; verify counts at each step."""
        print("\n=== TESTING PRODUCTS MANAGEMENT ===")

        success, products = self.run_test("Get Products", "GET", "products", 200)
        if not success:
            return False

        # FIX: products may be a dict with a list inside (e.g. {"items": [...]})
        # Normalise to a plain list so len() and indexing work correctly.
        if isinstance(products, dict):
            products = products.get("items") or products.get("data") or products.get("products") or []

        initial_count = len(products)
        print(f"   Initial products count: {initial_count}")

        product_suffix = self.unique_suffix()
        test_product = {
            "name":     f"Test Product {product_suffix}",
            "price":    99.99,
            "stock":    50,
            "category": "Test Category",
        }

        success, created_product = self.run_test(
            "Create Product", "POST", "products", 200, data=test_product
        )
        if not success:
            return False

        created_product = self.unwrap_response_data(created_product)
        product_id = created_product.get("id")
        print(f"   Created product ID: {product_id}")

        # FIX: guard against None product_id before attempting further ops
        if product_id is None:
            print("   [FAIL] Server did not return an 'id' for the created product.")
            return False

        # --- cleanup helper so we never orphan a test product ---
        def cleanup() -> None:
            self.run_test(
                "Cleanup — Delete Test Product",
                "DELETE",
                f"products/{product_id}",
                200,
            )

        try:
            success, _ = self.run_test(
                "Update Product",
                "PUT",
                f"products/{product_id}",
                200,
                data={"name": "Updated Test Product", "price": 149.99},
            )
            if not success:
                return False

            success, products_after = self.run_test(
                "Get Products After Create", "GET", "products", 200
            )
            # FIX: normalise again after each GET
            if isinstance(products_after, dict):
                products_after = (
                    products_after.get("items")
                    or products_after.get("data")
                    or products_after.get("products")
                    or []
                )
            if success and len(products_after) == initial_count + 1:
                print(f"   Products count increased to: {len(products_after)}")

            success, _ = self.run_test(
                "Delete Product", "DELETE", f"products/{product_id}", 200
            )
            if not success:
                return False

            success, products_final = self.run_test(
                "Get Products After Delete", "GET", "products", 200
            )
            if isinstance(products_final, dict):
                products_final = (
                    products_final.get("items")
                    or products_final.get("data")
                    or products_final.get("products")
                    or []
                )
            if success and len(products_final) == initial_count:
                print(f"   Products count back to: {len(products_final)}")
                return True

            return False

        except Exception:
            cleanup()
            raise

    # ------------------------------------------------------------------
    # Billing flow
    # ------------------------------------------------------------------
    def test_billing_flow(self) -> bool:
        """Create a bill and verify it appears in the bills list."""
        print("\n=== TESTING BILLING FLOW ===")

        success, products = self.run_test(
            "Get Products for Billing", "GET", "products", 200
        )
        if not success:
            return False

        # FIX: normalise products to list
        if isinstance(products, dict):
            products = products.get("items") or products.get("data") or products.get("products") or []

        temp_product_id: "str | None" = None  # track any product we create so we can clean it up

        try:
            if len(products) == 0:
                product_suffix = self.unique_suffix()
                test_product = {
                    "name":     f"Billing Test Product {product_suffix}",
                    "price":    25.50,
                    "stock":    100,
                    "category": "Test",
                }
                success, created_product = self.run_test(
                    "Create Product for Billing", "POST", "products", 200, data=test_product
                )
                if not success:
                    return False
                created_product = self.unwrap_response_data(created_product)
                products         = [created_product]
                temp_product_id  = created_product.get("id")

            product   = products[0]
            bill_data = {
                "items": [
                    {
                        "id":       product["id"],
                        "name":     product["name"],
                        "quantity": 2,
                        "price":    product["price"],
                    }
                ],
                "total":          round(product["price"] * 2, 2),
                "payment_type":   "Cash",
                "order_type":     "Dine-In",
                "table_label":    "T2",
                "guests_count":   2,
                "customer_name":  "Billing Test Customer",
                "customer_phone": "9876543210",
            }

            success, created_bill = self.run_test(
                "Create Bill", "POST", "bills", 200, data=bill_data
            )
            if not success:
                return False

            created_bill = self.unwrap_response_data(created_bill)
            bill_id = created_bill.get("id")
            print(f"   Created bill ID: {bill_id}")

            success, bills = self.run_test("Get Bills", "GET", "bills", 200)
            if not success:
                return False

            # FIX: normalise bills to list for len()
            if isinstance(bills, dict):
                bills = bills.get("items") or bills.get("data") or bills.get("bills") or []
            print(f"   Total bills: {len(bills)}")

            # FIX: guard against None bill_id
            if bill_id is None:
                print("   [FAIL] Server did not return an 'id' for the created bill.")
                return False

            success, bill_details = self.run_test(
                "Get Bill Details", "GET", f"bills/{bill_id}", 200
            )
            if success:
                print(
                    f"   Bill total: Rs.{bill_details.get('total')}, "
                    f"Payment: {bill_details.get('payment_type')}"
                )
                return True

            return False

        finally:
            # Remove any temporary product we created, regardless of test outcome
            if temp_product_id is not None:
                self.run_test(
                    "Cleanup — Delete Billing Test Product",
                    "DELETE",
                    f"products/{temp_product_id}",
                    200,
                )

    # ------------------------------------------------------------------
    # Staff management
    # ------------------------------------------------------------------
    def test_staff_management(self) -> bool:
        """Owner can create a cashier account and see it appear in the staff list."""
        print("\n=== TESTING STAFF MANAGEMENT ===")

        success, staff = self.run_test("Get Staff", "GET", "staff", 200)
        if not success:
            return False

        # FIX: normalise staff response to list
        if isinstance(staff, dict):
            staff = staff.get("items") or staff.get("data") or staff.get("staff") or []

        initial_count = len(staff)
        print(f"   Initial staff count: {initial_count}")

        timestamp  = self.unique_suffix()
        test_staff = {
            "name":     f"Test Cashier {timestamp}",
            "email":    f"cashier{timestamp}@test.com",
            "password": "testpass123",
            "phone":    "1234567890",
        }

        success, created_staff = self.run_test(
            "Create Staff", "POST", "staff", 200, data=test_staff
        )
        if not success:
            return False

        created_staff = self.unwrap_response_data(created_staff)
        print(
            f"   Created staff: {created_staff.get('name')} ({created_staff.get('email')})"
        )

        success, staff_after = self.run_test(
            "Get Staff After Create", "GET", "staff", 200
        )
        if isinstance(staff_after, dict):
            staff_after = staff_after.get("items") or staff_after.get("data") or staff_after.get("staff") or []

        if success and len(staff_after) == initial_count + 1:
            print(f"   Staff count increased to: {len(staff_after)}")
            return True

        return False

    # ------------------------------------------------------------------
    # Cashier authentication & role-based access
    # ------------------------------------------------------------------
    def test_cashier_login_and_access(self) -> bool:
        """
        Cashier can access billing endpoints but is denied owner-only routes.

        Uses a dedicated requests.Session so the cashier's cookie does not
        bleed into the owner session (and vice-versa).
        """
        print("\n=== TESTING CASHIER AUTHENTICATION & ACCESS ===")

        # Create a fresh cashier account via the owner session
        timestamp  = self.unique_suffix()
        test_staff = {
            "name":     f"Test Cashier {timestamp}",
            "email":    f"cashier{timestamp}@test.com",
            "password": "testpass123",
            "phone":    "1234567890",
        }

        success, _ = self.run_test(
            "Create Cashier for Login Test", "POST", "staff", 200, data=test_staff
        )
        if not success:
            return False

        # --- Dedicated session for the cashier ---
        cashier_session = requests.Session()

        # Log in with that session (do NOT use self.owner_session here)
        success, response = self.run_test(
            "Cashier Login",
            "POST",
            "auth/login",
            200,
            data={"email": test_staff["email"], "password": test_staff["password"]},
            session=cashier_session,
        )
        if not success:
            return False

        response = self.unwrap_response_data(response)
        print(f"   Cashier logged in: {response.get('name')} ({response.get('role')})")

        # Cashier should reach product / billing endpoints
        success, _ = self.run_test(
            "Cashier Get Products", "GET", "products", 200, session=cashier_session
        )
        if not success:
            print("   [FAIL] Cashier could not access products - unexpected")
            return False

        # Cashier must be denied owner-only endpoints (expect 403)
        success, _ = self.run_test(
            "Cashier Dashboard Access (Should Fail)",
            "GET",
            "dashboard/stats",
            403,
            session=cashier_session,
        )
        if success:
            print("   [PASS] Cashier correctly denied dashboard access")
        else:
            print("   [FAIL] Cashier was NOT denied dashboard access - role check missing!")
            return False

        success, _ = self.run_test(
            "Cashier Staff Access (Should Fail)",
            "GET",
            "staff",
            403,
            session=cashier_session,
        )
        if success:
            print("   [PASS] Cashier correctly denied staff access")
            return True
        else:
            print("   [FAIL] Cashier was NOT denied staff access - role check missing!")
            return False

    # ------------------------------------------------------------------
    # Logout
    # ------------------------------------------------------------------
    def test_logout(self) -> bool:
        """After logout the owner session should be rejected on protected routes."""
        print("\n=== TESTING LOGOUT ===")

        success, _ = self.run_test("Logout", "POST", "auth/logout", 200)
        if not success:
            return False

        success, _ = self.run_test(
            "Access After Logout (Should Fail)", "GET", "auth/me", 401
        )
        if success:
            print("   [PASS] Logout successful - access denied after logout")
            return True

        return False


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> int:
    print("Starting POS System API Testing...")
    print("=" * 50)
    print(f"   Target: {BASE_URL}")
    print(f"   Owner:  {OWNER_EMAIL}")
    print("=" * 50)

    tester = POSAPITester(base_url=BASE_URL)

    tests = [
        tester.test_owner_login,
        tester.test_owner_me,
        tester.test_dashboard_stats,
        tester.test_products_crud,
        tester.test_billing_flow,
        tester.test_staff_management,
        tester.test_cashier_login_and_access,
        tester.test_logout,
    ]

    failed_tests: "list[str]" = []

    for test in tests:
        try:
            if not test():
                failed_tests.append(test.__name__)
        except Exception as exc:
            print(f"[FAIL] {test.__name__} raised an unexpected exception: {exc}")
            failed_tests.append(test.__name__)

    print("\n" + "=" * 50)
    print(f"Test Results: {tester.tests_passed}/{tester.tests_run} individual checks passed")

    if failed_tests:
        print(f"[FAIL] Failed test groups: {', '.join(failed_tests)}")
        return 1

    print("[PASS] All tests passed!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
